// Embedding client — turns text into a vector using a LOCAL embedding model.
//
// The embedding model is just another llama.cpp server, on its own port (e.g.
// http://127.0.0.1:8090), serving the OpenAI-compatible POST /v1/embeddings.
// Keeping it separate from the chat models means we can load a small, fast
// embedder (nomic-embed-text, bge-small) without touching the planner/coder.
//
// Everything is loopback, so the egress guard already permits it. No SDK, plain
// fetch, same sovereign posture as the chat provider.

import { AgentError } from "../../core/types.ts";

export interface EmbeddingOptions {
  /** e.g. http://127.0.0.1:8090 */
  baseUrl: string;
  /** Model id the server routes on. */
  modelId: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface WireEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class EmbeddingProvider {
  readonly #baseUrl: string;
  readonly #modelId: string;
  readonly #apiKey: string | undefined;
  readonly #timeoutMs: number;

  constructor(opts: EmbeddingOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#modelId = opts.modelId;
    this.#apiKey = opts.apiKey;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
  }

  #headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.#apiKey) h["authorization"] = `Bearer ${this.#apiKey}`;
    return h;
  }

  /** Embed a single string. */
  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new AgentError("PROVIDER_ERROR", "Embedding server returned no vector");
    return vec;
  }

  /** Embed several strings in one request. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const endpoint = `${this.#baseUrl}/v1/embeddings`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ model: this.#modelId, input: texts }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new AgentError(
        "PROVIDER_UNREACHABLE",
        `Cannot reach embedding server at ${this.#baseUrl}. Is it running?`,
        { retryable: true, cause: err },
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "<unreadable>");
      throw new AgentError(
        "PROVIDER_ERROR",
        `Embedding server returned ${res.status}: ${detail.slice(0, 300)}`,
        { retryable: res.status >= 500 },
      );
    }

    const json = (await res.json()) as WireEmbeddingResponse;
    const vectors = (json.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
      throw new AgentError("PROVIDER_ERROR", "Embedding response was malformed or incomplete");
    }
    return vectors;
  }

  /** Cheap reachability check for /healthz. */
  async health(): Promise<{ reachable: boolean; detail?: string }> {
    try {
      await this.embed("ping");
      return { reachable: true };
    } catch (err) {
      return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
