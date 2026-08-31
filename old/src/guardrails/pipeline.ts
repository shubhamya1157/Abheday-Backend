import { AgentError } from "../core/types.ts";

export type GuardStage = "user_input" | "tool_args" | "tool_result" | "model_output";
export type GuardAction = "allow" | "sanitize" | "block";

export interface GuardVerdict {
  action: GuardAction;
  text?: string;
  reason?: string;
}

export interface GuardInput {
  stage: GuardStage;
  text: string;
// sessionId --> conversationId
  sessionId: string;
  toolName?: string;
  toolTier?: "read" | "write" | "execute";
  toolArgs?: Record<string, unknown>;
}

export interface Guard {
  readonly name: string;
  readonly stages: readonly GuardStage[];
  check(input: GuardInput): Promise<GuardVerdict> | GuardVerdict;
}

/** Outcome of running a whole stage. */
export interface PipelineResult {
  /** Text to use going forward — sanitised if any guard rewrote it. */ 
  action: GuardAction;
  text: string;
  blockedBy?: string;
  reason?: string;
  trace: GuardTraceEntry[];
  totalLatencyMs: number;
}

export interface GuardTraceEntry {
  guard: string;
  action: GuardAction;
  reason?: string;
  latencyMs: number; 
  errored?: boolean;
}

export interface PipelineOptions {
  failClosed?: boolean;
  guardTimeoutMs?: number;
  blockedMessage?: string;
  onTrace?: (stage: GuardStage, entry: GuardTraceEntry) => void;
}

export class GuardrailPipeline {
  private readonly guards: Guard[] = [];
  private readonly failClosed: boolean;
  private readonly guardTimeoutMs: number;
  private readonly blockedMessage: string;
  private readonly onTrace: ((s: GuardStage, e: GuardTraceEntry) => void) | undefined;

  constructor(opts: PipelineOptions = {}) {
    this.failClosed = opts.failClosed ?? true;
    this.guardTimeoutMs = opts.guardTimeoutMs ?? 5_000;
    this.blockedMessage = opts.blockedMessage ?? "[BLOCKED_BY_POLICY]";
    this.onTrace = opts.onTrace;
  }

  add(guard: Guard): this {
    this.guards.push(guard);
    return this;
  }

  addAll(guards: readonly Guard[]): this {
    for (const g of guards) this.add(g);
    return this;
  }

  /** Guards registered for a stage, in insertion order. */
  guardsFor(stage: GuardStage): Guard[] {
    return this.guards.filter((g) => g.stages.includes(stage));
  }

  /**
   * Run every guard for a stage. Short-circuits on the first block.
   * Sanitisations chain: guard N sees the text guard N-1 produced.
   */
  async run(input: GuardInput): Promise<PipelineResult> {
    const started = Date.now();
    const trace: GuardTraceEntry[] = [];
    let text = input.text;
    let action: GuardAction = "allow";

    for (const guard of this.guardsFor(input.stage)) {
      const guardStart = Date.now();
      let verdict: GuardVerdict;
      let errored = false;

      try {
        verdict = await this.withTimeout(guard, { ...input, text });
      } catch (err) {
        errored = true;
        // An egress violation inside a guard is a sovereignty failure and must
        // surface as itself, not be flattened into a generic block.
        if (err instanceof AgentError && err.code === "EGRESS_BLOCKED") throw err;

        verdict = this.failClosed
          ? {
              action: "block",
              reason: `guard "${guard.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            }
          : { action: "allow", reason: `guard "${guard.name}" errored and was skipped` };
      }

      const entry: GuardTraceEntry = {
        guard: guard.name,
        action: verdict.action,
        latencyMs: Date.now() - guardStart,
      };
      if (verdict.reason !== undefined) entry.reason = verdict.reason;
      if (errored) entry.errored = true;
      trace.push(entry);
      this.onTrace?.(input.stage, entry);

      if (verdict.action === "block") {
        const result: PipelineResult = {
          action: "block",
          text: this.blockedMessage,
          blockedBy: guard.name,
          trace,
          totalLatencyMs: Date.now() - started,
        };
        if (verdict.reason !== undefined) result.reason = verdict.reason;
        return result;
      }

      if (verdict.action === "sanitize") {
        text = verdict.text ?? text;
        action = "sanitize";
      }
    }

    return { action, text, trace, totalLatencyMs: Date.now() - started };
  }

  private async withTimeout(guard: Guard, input: GuardInput): Promise<GuardVerdict> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_r, reject) => {
      timer = setTimeout(
        () => reject(new Error(`guard timed out after ${this.guardTimeoutMs}ms`)),
        this.guardTimeoutMs,
      );
    });
    try {
      return await Promise.race([Promise.resolve(guard.check(input)), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function makeGuard(
  name: string,
  stages: readonly GuardStage[],
  check: (input: GuardInput) => Promise<GuardVerdict> | GuardVerdict,
): Guard {
  return { name, stages, check };
}
