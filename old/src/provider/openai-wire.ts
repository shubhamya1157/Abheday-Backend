/**
 * OpenAI-compatible wire format — hand-written, zero SDK.
 *
 * This is the ONLY file in the repo that knows what the HTTP payload looks
 * like. Everything above it speaks `Message` / `GenerateResult` from
 * core/types.ts. That separation is what makes the "no vendor SDK" constraint
 * cheap instead of painful: swapping to vLLM or Ollama means writing a sibling
 * of this file, not touching the agent.
 *
 * Defensive by design. llama.cpp's server and LM Studio both claim OpenAI
 * compatibility and both deviate:
 *   - `content` may be null, absent, or "" when tool_calls are present.
 *   - `usage` may be missing entirely on streamed responses.
 *   - `finish_reason` may be "tool_calls", "function_call", "stop", or null.
 *   - LM Studio has been known to emit tool arguments as an object rather than
 *     the spec-mandated JSON *string*.
 * Every mapper below tolerates all of the above rather than throwing, because a
 * hard parse error mid-demo is unrecoverable while a degraded parse is not.
 */

import type {
  FinishReason,
  GenerateResult,
  JsonSchema,
  Message,
  RawToolCall,
  TokenUsage,
  ToolSchema,
} from "../core/types.ts";

/* ------------------------------------------------------------------------- */
/* Outbound                                                                   */
/* ------------------------------------------------------------------------- */

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface WireToolDef {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

export interface WireChatRequest {
  model: string;
  messages: WireMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  tools?: WireToolDef[];
  tool_choice?: "auto" | "none" | "required";
  seed?: number;
  /** llama.cpp extension: GBNF grammar for constrained decoding. */
  grammar?: string;
  /** llama.cpp extension: server compiles this into a grammar. */
  json_schema?: JsonSchema;
  /** llama.cpp extension: reuse the KV cache for the shared prefix. Big win —
   *  our system prompt is long and identical across every turn. */
  cache_prompt?: boolean;
}

/** Convert our internal messages into wire messages. */
export function toWireMessages(messages: readonly Message[]): WireMessage[] {
  return messages.map((m) => {
    const wire: WireMessage = { role: m.role, content: m.content };

    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        // Re-serialise from parsed args, not `raw`. If we repaired malformed
        // JSON, the model must see the repaired version on the next turn or it
        // will keep reproducing its own broken syntax.
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
    }

    if (m.role === "tool") {
      if (m.toolCallId !== undefined) wire.tool_call_id = m.toolCallId;
      if (m.name !== undefined) wire.name = m.name;
    }

    return wire;
  });
}

export function toWireTools(tools: readonly ToolSchema[]): WireToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/* ------------------------------------------------------------------------- */
/* Inbound                                                                    */
/* ------------------------------------------------------------------------- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function mapFinishReason(raw: unknown): FinishReason {
  switch (asString(raw)) {
    case "stop":
    case "eos":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "abort":
    case "cancelled":
      return "abort";
    default:
      return "unknown";
  }
}

export function mapUsage(raw: unknown): TokenUsage {
  const u = asRecord(raw);
  const prompt = asNumber(u?.["prompt_tokens"]) ?? 0;
  const completion = asNumber(u?.["completion_tokens"]) ?? 0;
  const total = asNumber(u?.["total_tokens"]) ?? prompt + completion;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/**
 * Extract native tool calls from a message object.
 * Tolerates the LM Studio deviation where `arguments` is already an object.
 */
export function mapToolCalls(rawMessage: unknown): RawToolCall[] | undefined {
  const msg = asRecord(rawMessage);
  const list = msg?.["tool_calls"];
  if (!Array.isArray(list) || list.length === 0) return undefined;

  const out: RawToolCall[] = [];
  for (const item of list) {
    const call = asRecord(item);
    if (!call) continue;
    const fn = asRecord(call["function"]);
    const name = asString(fn?.["name"]) ?? asString(call["name"]);
    if (!name) continue;

    const rawArgs = fn?.["arguments"] ?? call["arguments"];
    let argumentsJson: string;
    if (typeof rawArgs === "string") {
      argumentsJson = rawArgs;
    } else if (rawArgs === undefined || rawArgs === null) {
      argumentsJson = "{}";
    } else {
      // Spec violation, but harmless — re-serialise it ourselves.
      argumentsJson = JSON.stringify(rawArgs);
    }

    const entry: RawToolCall = { name, argumentsJson };
    const id = asString(call["id"]);
    if (id !== undefined) entry.id = id;
    out.push(entry);
  }

  return out.length > 0 ? out : undefined;
}

/** Map a complete (non-streamed) chat completion response. */
export function fromWireResponse(json: unknown, latencyMs: number): GenerateResult {
  const root = asRecord(json);
  const choices = root?.["choices"];
  const first = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const message = asRecord(first?.["message"]);

  // Some servers put the text on `text` (legacy completions shape) instead of
  // `message.content`. Check both so a misconfigured endpoint still works.
  const text =
    asString(message?.["content"]) ??
    asString(first?.["text"]) ??
    "";

  const toolCalls = mapToolCalls(message);
  const result: GenerateResult = {
    text,
    finishReason: mapFinishReason(first?.["finish_reason"]),
    usage: mapUsage(root?.["usage"]),
    latencyMs,
  };
  if (toolCalls) result.toolCalls = toolCalls;
  const model = asString(root?.["model"]);
  if (model !== undefined) result.model = model;
  return result;
}

/* ------------------------------------------------------------------------- */
/* Streaming deltas                                                           */
/* ------------------------------------------------------------------------- */

export interface StreamDelta {
  text: string;
  toolCallDeltas: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }>;
  finishReason: FinishReason | undefined;
  usage: TokenUsage | undefined;
  model: string | undefined;
}

/** Map one `data:` payload from a streamed completion. */
export function fromWireChunk(json: unknown): StreamDelta {
  const root = asRecord(json);
  const choices = root?.["choices"];
  const first = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const delta = asRecord(first?.["delta"]) ?? asRecord(first?.["message"]);

  const out: StreamDelta = {
    text: asString(delta?.["content"]) ?? "",
    toolCallDeltas: [],
    finishReason: undefined,
    usage: undefined,
    model: asString(root?.["model"]),
  };

  const rawFinish = first?.["finish_reason"];
  if (rawFinish !== undefined && rawFinish !== null) {
    out.finishReason = mapFinishReason(rawFinish);
  }
  if (root?.["usage"] !== undefined && root["usage"] !== null) {
    out.usage = mapUsage(root["usage"]);
  }

  const tcs = delta?.["tool_calls"];
  if (Array.isArray(tcs)) {
    for (let i = 0; i < tcs.length; i++) {
      const call = asRecord(tcs[i]);
      if (!call) continue;
      const fn = asRecord(call["function"]);
      // `index` tells us which call a fragment belongs to when the model emits
      // several in parallel. Fall back to array position if absent.
      const entry: { index: number; id?: string; name?: string; argumentsDelta?: string } = {
        index: asNumber(call["index"]) ?? i,
      };
      const id = asString(call["id"]);
      const name = asString(fn?.["name"]);
      const argsDelta = asString(fn?.["arguments"]);
      if (id !== undefined) entry.id = id;
      if (name !== undefined) entry.name = name;
      if (argsDelta !== undefined) entry.argumentsDelta = argsDelta;
      out.toolCallDeltas.push(entry);
    }
  }

  return out;
}

/**
 * Accumulate streamed tool-call fragments into complete RawToolCalls.
 * Servers send the name once and then dribble the arguments string across many
 * chunks, so this has to be stateful.
 */
export function createToolCallAccumulator() {
  const byIndex = new Map<number, { id?: string; name: string; args: string }>();

  return {
    add(deltas: StreamDelta["toolCallDeltas"]): void {
      for (const d of deltas) {
        const existing = byIndex.get(d.index);
        if (existing) {
          if (d.name !== undefined && existing.name.length === 0) existing.name = d.name;
          if (d.id !== undefined && existing.id === undefined) existing.id = d.id;
          if (d.argumentsDelta !== undefined) existing.args += d.argumentsDelta;
        } else {
          const created: { id?: string; name: string; args: string } = {
            name: d.name ?? "",
            args: d.argumentsDelta ?? "",
          };
          if (d.id !== undefined) created.id = d.id;
          byIndex.set(d.index, created);
        }
      }
    },

    finish(): RawToolCall[] | undefined {
      if (byIndex.size === 0) return undefined;
      const out: RawToolCall[] = [];
      for (const idx of [...byIndex.keys()].sort((a, b) => a - b)) {
        const v = byIndex.get(idx);
        if (!v || v.name.length === 0) continue;
        const entry: RawToolCall = {
          name: v.name,
          argumentsJson: v.args.length > 0 ? v.args : "{}",
        };
        if (v.id !== undefined) entry.id = v.id;
        out.push(entry);
      }
      return out.length > 0 ? out : undefined;
    },
  };
}
