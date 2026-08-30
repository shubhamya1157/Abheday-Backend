/**
 * Canonical domain types for the agent core.
 *
 * DESIGN RULE: this file has ZERO imports. It is the shared vocabulary that
 * every layer (provider / protocol / tools / guardrails / agent / harness)
 * speaks. Keeping it dependency-free means:
 *   1. No layer can accidentally couple to a vendor wire format.
 *   2. Every module that only imports this file is unit-testable with
 *      plain `node file.ts` and no network, no npm install.
 *
 * We define our OWN message shape rather than reusing an OpenAI/Anthropic
 * type. Wire formats are an implementation detail of the provider layer and
 * MUST NOT leak upward. That is the whole reason we can be SDK-free.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A tool invocation the model asked for, already parsed and normalised. */
export interface ToolCall {
  /** Stable id used to correlate the call with its result. */
  id: string;
  name: string;
  /** Parsed arguments. Validated against the tool's schema before execution. */
  args: Record<string, unknown>;
  /**
   * The exact text the model emitted for this call, kept verbatim for the
   * audit log. When a local model emits malformed JSON that we repair, this
   * preserves what it *actually* said, so a reviewer can see the repair.
   */
  raw?: string;
  /** True when `args` came out of the JSON-repair path rather than clean parse. */
  repaired?: boolean;
}

/** The outcome of executing a ToolCall. Always text — this is a text-to-text core. */
export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  /** Text fed back to the model. Truncated to fit the budget if needed. */
  content: string;
  /** Present when ok === false. Also surfaced to the model so it can recover. */
  error?: string;
  durationMs: number;
  /** True when `content` was cut to respect maxToolResultChars. */
  truncated?: boolean;
  /** Set when a guardrail rewrote or blocked the result. */
  guardrailAction?: "allow" | "sanitized" | "blocked";
}

export interface Message {
  role: Role;
  content: string;
  /** Only on role === "assistant". */
  toolCalls?: ToolCall[];
  /** Only on role === "tool" — correlates back to ToolCall.id. */
  toolCallId?: string;
  /** Only on role === "tool" — the tool's name. */
  name?: string;
  /**
   * Internal bookkeeping, never sent to the model. Used by context compaction
   * to decide what is safe to drop or summarise.
   */
  meta?: MessageMeta;
}

export interface MessageMeta {
  /** Which loop iteration produced this message. */
  step?: number;
  /** Estimated token cost, filled in lazily by the context manager. */
  tokens?: number;
  /** Pinned messages are never dropped or summarised by compaction. */
  pinned?: boolean;
  /** Marks a message produced by compaction (a summary of dropped history). */
  synthetic?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Tool declarations                                                          */
/* ------------------------------------------------------------------------- */

/**
 * A tool as advertised to the model. `parameters` is JSON Schema, because that
 * is the lingua franca both native function-calling and our prompted protocol
 * can consume. The registry derives this from a zod schema so the handler
 * stays type-safe.
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
  /**
   * Risk tier, consumed by the tool-policy guardrail.
   *  - "read"    : observes state only
   *  - "write"   : mutates the workspace
   *  - "execute" : runs arbitrary code — always requires explicit policy
   */
  tier: "read" | "write" | "execute";
  /** Hard wall-clock cap for a single invocation. */
  timeoutMs?: number;
}

/** Minimal structural JSON Schema. Not exhaustive — just what we emit/consume. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [k: string]: unknown;
}

/* ------------------------------------------------------------------------- */
/* Provider contract                                                          */
/* ------------------------------------------------------------------------- */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "abort" | "unknown";

/**
 * A tool call exactly as the *server* reported it, before we normalise it.
 * Arguments arrive as a JSON string in the OpenAI-compatible shape, and local
 * servers frequently produce invalid JSON here — normalisation happens in the
 * protocol layer, not the provider.
 */
export interface RawToolCall {
  id?: string;
  name: string;
  argumentsJson: string;
}

export interface GenerateRequest {
  messages: Message[];
  /** Advertised tools. Ignored by the prompted protocol (it inlines them). */
  tools?: ToolSchema[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Extra stop sequences. The prompted protocol adds its own closing tag. */
  stop?: string[];
  /**
   * llama.cpp / LM Studio constrained decoding. When set, the server is forced
   * to emit only strings matching this GBNF grammar. This is our strongest
   * guarantee of parseable tool calls on small models.
   */
  grammar?: string;
  /** llama.cpp `json_schema` field — server converts it to a grammar for us. */
  jsonSchema?: JsonSchema;
  signal?: AbortSignal;
  /** Deterministic sampling for reproducible demos and evals. */
  seed?: number;
}

export interface GenerateResult {
  text: string;
  /** Populated only when the server did native function calling. */
  toolCalls?: RawToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
  latencyMs: number;
  /** Model identifier the server reported, recorded in the Trust Receipt. */
  model?: string;
}

/** Incremental output during streaming. */
export type StreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool_call_delta"; index: number; name?: string; argumentsDelta?: string }
  | { kind: "done"; result: GenerateResult };

export interface HealthInfo {
  reachable: boolean;
  /** Model id as reported by GET /v1/models. */
  model?: string;
  /** True when the server accepted a `tools` payload during capability probing. */
  supportsNativeTools?: boolean;
  /** True when the server accepted a `grammar` payload. */
  supportsGrammar?: boolean;
  detail?: string;
}

/**
 * The ONLY interface the agent loop knows about. Swapping llama.cpp for vLLM,
 * or swapping in a scripted fake for tests, means implementing four methods.
 */
export interface ModelProvider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  stream(req: GenerateRequest): AsyncIterable<StreamChunk>;
  health(): Promise<HealthInfo>;
}

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export type AgentErrorCode =
  | "PROVIDER_UNREACHABLE"
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "EGRESS_BLOCKED"
  | "GUARDRAIL_BLOCKED"
  | "TOOL_NOT_FOUND"
  | "TOOL_INVALID_ARGS"
  | "TOOL_FAILED"
  | "TOOL_TIMEOUT"
  | "PROTOCOL_UNPARSEABLE"
  | "BUDGET_EXCEEDED"
  | "MAX_STEPS"
  | "NO_PROGRESS"
  | "ABORTED";

/**
 * One error type with a machine-readable code. `retryable` lets the harness
 * decide recovery strategy without string-matching messages.
 */
export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    code: AgentErrorCode,
    message: string,
    opts?: { retryable?: boolean; detail?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AgentError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.detail = opts?.detail;
  }
}
