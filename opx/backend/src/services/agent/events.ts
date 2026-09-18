/**
 * The loop's observable output.
 *
 * The loop is an async generator of these events rather than a function that
 * returns a string, for three reasons:
 *
 * 1. The HTTP layer becomes trivial — the SSE route iterates and forwards. No
 *    callback plumbing, no EventEmitter lifetime bugs, and backpressure works
 *    because the generator only advances when the consumer pulls.
 * 2. The audit log becomes trivial — the Trust Receipt writer consumes the same
 *    event stream. There is exactly one description of what happened, so the log
 *    cannot drift from what the operator saw.
 * 3. Tests become trivial — collect the events into an array and assert on the
 *    sequence. Asserting on a sequence of typed events is far stronger than
 *    asserting on a final string.
 *
 * Every event carries `seq` and `at`. The sequence number is what the hash chain
 * in the receipt is ordered by, so a gap is detectable evidence of tampering or
 * of a dropped event, rather than something nobody notices.
 */

import type { FinishReason, ToolCall, ToolResult, TokenUsage } from "../../core/types.ts";
import type { GuardStage } from "../guardrails/pipeline.ts";

export interface EventBase {
  /** Monotonic, starts at 1, no gaps. */
  seq: number;
  /** ISO timestamp. */
  at: string;
}

export type AgentEvent =
  | (EventBase & { type: "run_start"; runId: string; input: string; model: string })
  | (EventBase & { type: "step_start"; step: number })
  /** Incremental assistant text. Only emitted when streaming is on. */
  | (EventBase & { type: "text_delta"; step: number; text: string })
  /** The complete assistant message for a step, after guardrails. */
  | (EventBase & {
      type: "assistant_message";
      step: number;
      text: string;
      finishReason: FinishReason;
      usage?: TokenUsage;
    })
  | (EventBase & { type: "tool_call"; step: number; call: ToolCall })
  | (EventBase & {
      type: "tool_result";
      step: number;
      call: ToolCall;
      result: ToolResult;
      durationMs: number;
    })
  | (EventBase & {
      type: "guardrail";
      stage: GuardStage;
      guard: string;
      action: "block" | "sanitize";
      reason: string;
      /** Present when the block ended the run. */
      fatal?: boolean;
    })
  | (EventBase & {
      type: "compaction";
      droppedMessages: number;
      tokensBefore: number;
      tokensAfter: number;
      method: "model" | "mechanical";
    })
  /** Recoverable oddity worth surfacing but not worth stopping for. */
  | (EventBase & { type: "notice"; level: "info" | "warn"; message: string; detail?: unknown })
  | (EventBase & {
      type: "run_end";
      runId: string;
      outcome: RunOutcome;
    });

export type StopReason =
  /** The model produced a text answer with no tool calls. */
  | "completed"
  /** Step budget exhausted. */
  | "max_steps"
  /** Token budget exhausted. */
  | "token_budget"
  /** Wall-clock budget exhausted. */
  | "timeout"
  /** Caller aborted. */
  | "aborted"
  /** A guardrail blocked and the run could not continue. */
  | "blocked"
  /** The model kept repeating an identical failing action. */
  | "no_progress"
  /** Provider or internal failure. */
  | "error";

export interface RunOutcome {
  runId: string;
  stopReason: StopReason;
  /** The final assistant text shown to the operator. */
  text: string;
  steps: number;
  toolCallCount: number;
  usage: TokenUsage;
  durationMs: number;
  /** Populated when stopReason is "error" or "blocked". */
  error?: { code: string; message: string };
}

/* ------------------------------------------------------------------------- */

/**
 * Stamps sequence numbers and timestamps so no call site can forget to.
 *
 * Deliberately not a global: two concurrent runs must not share a counter, or the
 * receipts interleave and neither verifies.
 */
export class EventFactory {
  #seq = 0;
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  make<T extends AgentEvent["type"]>(
    type: T,
    payload: Omit<Extract<AgentEvent, { type: T }>, keyof EventBase | "type">,
  ): Extract<AgentEvent, { type: T }> {
    this.#seq += 1;
    return {
      type,
      seq: this.#seq,
      at: this.#now().toISOString(),
      ...payload,
    } as Extract<AgentEvent, { type: T }>;
  }

  get count(): number {
    return this.#seq;
  }
}

/** Human-readable one-liner. Used by the CLI and by log lines. */
export function describeEvent(e: AgentEvent): string {
  switch (e.type) {
    case "run_start":
      return `run ${e.runId} started on ${e.model}`;
    case "step_start":
      return `step ${e.step}`;
    case "text_delta":
      return `…${e.text}`;
    case "assistant_message":
      return `assistant (${e.finishReason}): ${truncate(e.text, 120)}`;
    case "tool_call":
      return `→ ${e.call.name}(${truncate(JSON.stringify(e.call.args), 120)})`;
    case "tool_result":
      return `← ${e.call.name} ${e.result.ok ? "ok" : "ERROR"} in ${e.durationMs}ms: ${truncate(e.result.content, 120)}`;
    case "guardrail":
      return `guardrail ${e.guard} ${e.action} at ${e.stage}: ${e.reason}`;
    case "compaction":
      return `compacted ${e.droppedMessages} messages, ${e.tokensBefore}→${e.tokensAfter} tokens (${e.method})`;
    case "notice":
      return `[${e.level}] ${e.message}`;
    case "run_end":
      return `run ${e.runId} ended: ${e.outcome.stopReason} after ${e.outcome.steps} step(s), ${e.outcome.durationMs}ms`;
  }
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}
