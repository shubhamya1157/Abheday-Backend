/**
 * LlamaCppProvider — REST client for llama.cpp `llama-server` and LM Studio.
 *
 * Plain `fetch` against the OpenAI-compatible REST surface:
 *   POST /v1/chat/completions   (non-streaming and SSE streaming)
 *   GET  /v1/models             (health + model identity)
 *   GET  /props                 (llama.cpp only: context size, model path)
 *
 * No SDK. The constraint in this project is on vendor *client libraries*, not
 * on the HTTP contract — so we get to use the well-documented REST shape while
 * owning every byte we send. Concretely that buys us three things a vendor SDK
 * would deny us:
 *   1. `grammar` / `json_schema` — llama.cpp extensions no SDK exposes, and our
 *      single most effective defence against unparseable tool calls.
 *   2. `cache_prompt` — KV-cache reuse for our long, static system prompt.
 *   3. Full request/response capture for the Trust Receipt.
 */

import {
  AgentError,
  type GenerateRequest,
  type GenerateResult,
  type HealthInfo,
  type ModelProvider,
  type StreamChunk,
} from "../../core/types.ts";
import { iterateSse } from "./sse.ts";
import {
  createToolCallAccumulator,
  fromWireChunk,
  fromWireResponse,
  toWireMessages,
  toWireTools,
  type WireChatRequest,
} from "./openai-wire.ts";

export interface LlamaProviderOptions {
  /** e.g. http://127.0.0.1:8080 (llama.cpp) or http://127.0.0.1:1234 (LM Studio) */
  baseUrl: string;
  /**
   * Model id. llama-server ignores it and serves whatever is loaded; LM Studio
   * uses it to pick between loaded models.
   */
  model: string;
  /** Wall-clock cap for a single completion. CPU inference is slow — be generous. */
  requestTimeoutMs?: number;
  /** Retries for *connection-level* failures only, never for HTTP 4xx. */
  maxRetries?: number;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /** Send llama.cpp's cache_prompt. Harmless on servers that ignore it. */
  cachePrompt?: boolean;
  /** Optional bearer token — LM Studio can be configured to require one. */
  apiKey?: string;
  onRequestLog?: (info: RequestLog) => void;
}

export interface RequestLog {
  at: string;
  endpoint: string;
  promptMessages: number;
  streamed: boolean;
  latencyMs: number;
  status: number | "network-error";
  usage?: { promptTokens: number; completionTokens: number };
  attempt: number;
}

export class LlamaCppProvider implements ModelProvider {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;
  private readonly cachePrompt: boolean;
  private readonly apiKey: string | undefined;
  private readonly onRequestLog: ((i: RequestLog) => void) | undefined;

  constructor(opts: LlamaProviderOptions) {
    // Trailing slash would produce a double slash and some servers 404 on it.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.id = `llamacpp:${this.model}`;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 300_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.defaultTemperature = opts.defaultTemperature ?? 0.2;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 2048;
    this.cachePrompt = opts.cachePrompt ?? true;
    this.apiKey = opts.apiKey;
    this.onRequestLog = opts.onRequestLog;
  }

  /* --------------------------------------------------------------------- */

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private buildBody(req: GenerateRequest, stream: boolean): WireChatRequest {
    const body: WireChatRequest = {
      model: this.model,
      messages: toWireMessages(req.messages),
      temperature: req.temperature ?? this.defaultTemperature,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
      stream,
    };

    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.seed !== undefined) body.seed = req.seed;
    if (req.stop && req.stop.length > 0) body.stop = req.stop;
    if (this.cachePrompt) body.cache_prompt = true;

    // Native function calling. The prompted protocol leaves `tools` unset and
    // inlines tool docs into the system prompt instead.
    if (req.tools && req.tools.length > 0) {
      body.tools = toWireTools(req.tools);
      body.tool_choice = "auto";
    }

    // Constrained decoding. `grammar` wins if both are somehow supplied.
    if (req.grammar !== undefined) body.grammar = req.grammar;
    else if (req.jsonSchema !== undefined) body.json_schema = req.jsonSchema;

    return body;
  }

  /**
   * Combine our timeout with any caller-supplied AbortSignal.
   * AbortSignal.any is Node 20+. Without this, a client disconnect leaves an
   * inference request running and pinning the CPU for minutes.
   */
  private makeSignal(external: AbortSignal | undefined): {
    signal: AbortSignal;
    cleanup: () => void;
    timedOut: () => boolean;
  } {
    const timeoutController = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      timeoutController.abort();
    }, this.requestTimeoutMs);

    const signal = external
      ? AbortSignal.any([external, timeoutController.signal])
      : timeoutController.signal;

    return {
      signal,
      cleanup: () => clearTimeout(timer),
      timedOut: () => didTimeout,
    };
  }

  /* --------------------------------------------------------------------- */

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const body = this.buildBody(req, false);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const started = Date.now();
      const { signal, cleanup, timedOut } = this.makeSignal(req.signal);

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const detail = await safeText(res);
          this.onRequestLog?.({
            at: new Date().toISOString(),
            endpoint,
            promptMessages: body.messages.length,
            streamed: false,
            latencyMs: Date.now() - started,
            status: res.status,
            attempt,
          });
          // 4xx is our bug (bad schema, unknown field) — retrying is pointless
          // and just burns demo time. 5xx may be transient.
          throw new AgentError(
            "PROVIDER_ERROR",
            `Model server returned ${res.status}: ${truncate(detail, 500)}`,
            { retryable: res.status >= 500, detail: { status: res.status } },
          );
        }

        const json: unknown = await res.json();
        const result = fromWireResponse(json, Date.now() - started);
        this.onRequestLog?.({
          at: new Date().toISOString(),
          endpoint,
          promptMessages: body.messages.length,
          streamed: false,
          latencyMs: result.latencyMs,
          status: res.status,
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
          },
          attempt,
        });
        return result;
      } catch (err) {
        lastError = err;

        // Distinguish "caller cancelled" from "we timed out" from "server down".
        if (err instanceof AgentError) {
          if (!err.retryable || attempt === this.maxRetries) throw err;
        } else if (isAbortError(err)) {
          if (timedOut()) {
            throw new AgentError(
              "PROVIDER_TIMEOUT",
              `Model did not respond within ${this.requestTimeoutMs}ms. ` +
                `On CPU-only inference this usually means the context is too long ` +
                `or max_tokens is too high.`,
              { retryable: false },
            );
          }
          throw new AgentError("ABORTED", "Generation aborted by caller", { retryable: false });
        } else if (attempt === this.maxRetries) {
          throw new AgentError(
            "PROVIDER_UNREACHABLE",
            `Cannot reach model server at ${this.baseUrl}. Is the container running?`,
            { retryable: true, cause: err },
          );
        }

        // Linear backoff. Exponential is overkill against a local process.
        await sleep(250 * (attempt + 1));
      } finally {
        cleanup();
      }
    }

    throw new AgentError("PROVIDER_UNREACHABLE", "Exhausted retries contacting model server", {
      retryable: true,
      cause: lastError,
    });
  }

  /* --------------------------------------------------------------------- */

  async *stream(req: GenerateRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const body = this.buildBody(req, true);
    const started = Date.now();
    const { signal, cleanup, timedOut } = this.makeSignal(req.signal);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { ...this.headers(), accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const detail = await safeText(res);
        throw new AgentError(
          "PROVIDER_ERROR",
          `Model server returned ${res.status}: ${truncate(detail, 500)}`,
          { retryable: res.status >= 500, detail: { status: res.status } },
        );
      }
      if (!res.body) {
        throw new AgentError("PROVIDER_ERROR", "Streaming response had no body");
      }

      let text = "";
      let finishReason: GenerateResult["finishReason"] = "unknown";
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let model: string | undefined;
      const toolAcc = createToolCallAccumulator();

      for await (const ev of iterateSse(res.body)) {
        // The `[DONE]` sentinel is not JSON; it marks end of stream.
        if (ev.data === "[DONE]") break;

        let parsed: unknown;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          // A malformed frame is not fatal — skip it and keep the stream alive.
          continue;
        }

        const delta = fromWireChunk(parsed);
        if (delta.model !== undefined) model = delta.model;
        if (delta.usage !== undefined) usage = delta.usage;
        if (delta.finishReason !== undefined) finishReason = delta.finishReason;

        if (delta.text.length > 0) {
          text += delta.text;
          yield { kind: "text", delta: delta.text };
        }

        if (delta.toolCallDeltas.length > 0) {
          toolAcc.add(delta.toolCallDeltas);
          for (const d of delta.toolCallDeltas) {
            const chunk: StreamChunk = { kind: "tool_call_delta", index: d.index };
            if (d.name !== undefined) chunk.name = d.name;
            if (d.argumentsDelta !== undefined) chunk.argumentsDelta = d.argumentsDelta;
            yield chunk;
          }
        }
      }

      const toolCalls = toolAcc.finish();
      const result: GenerateResult = {
        text,
        finishReason,
        usage,
        latencyMs: Date.now() - started,
      };
      if (toolCalls) {
        result.toolCalls = toolCalls;
        // Servers often omit finish_reason when streaming tool calls.
        if (finishReason === "unknown") result.finishReason = "tool_calls";
      }
      if (model !== undefined) result.model = model;

      yield { kind: "done", result };
    } catch (err) {
      if (err instanceof AgentError) throw err;
      if (isAbortError(err)) {
        throw timedOut()
          ? new AgentError("PROVIDER_TIMEOUT", `Stream exceeded ${this.requestTimeoutMs}ms`)
          : new AgentError("ABORTED", "Stream aborted by caller");
      }
      throw new AgentError("PROVIDER_UNREACHABLE", `Stream failed against ${this.baseUrl}`, {
        retryable: true,
        cause: err,
      });
    } finally {
      cleanup();
    }
  }

  /* --------------------------------------------------------------------- */

  /**
   * Probe the server. Called at boot and exposed at GET /health so a demo can
   * show the operator exactly which local weights are answering.
   */
  async health(): Promise<HealthInfo> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return { reachable: false, detail: `GET /v1/models returned ${res.status}` };
      }
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const first = json.data?.[0];
      const info: HealthInfo = { reachable: true };
      if (first?.id !== undefined) info.model = first.id;
      return info;
    } catch (err) {
      if (err instanceof AgentError && err.code === "EGRESS_BLOCKED") throw err;
      return {
        reachable: false,
        detail: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  /**
   * Capability probe: send two microscopic requests to learn whether this
   * server actually honours `tools` and `grammar`. The protocol layer uses the
   * answer to pick native vs prompted mode automatically, so nobody has to know
   * which build of llama.cpp is deployed.
   */
  async probeCapabilities(): Promise<HealthInfo> {
    const base = await this.health();
    if (!base.reachable) return base;

    const supportsGrammar = await this.probeOne({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      // Trivial grammar: the single literal "x". Servers without grammar
      // support reject the unknown field or ignore it; either way we learn.
      grammar: 'root ::= "x"',
    });

    const supportsNativeTools = await this.probeOne({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1,
      tools: [
        {
          name: "noop",
          description: "probe",
          parameters: { type: "object", properties: {}, required: [] },
          tier: "read",
        },
      ],
    });

    return { ...base, supportsGrammar, supportsNativeTools };
  }

  private async probeOne(req: GenerateRequest): Promise<boolean> {
    try {
      await this.generate({ ...req, signal: AbortSignal.timeout(20_000) });
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------------- */

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
