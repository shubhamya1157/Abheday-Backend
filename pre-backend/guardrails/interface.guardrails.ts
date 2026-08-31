export interface CoreGuardRailsConfig{
    level: "standard" | "basic" | "advanced";
    outputBlockStrategy: "sanitize" | "block";
    blockedResponse:{
        response: string,
        data: Record<string,unknown>,
    };
    enabledGuards?: Array<"injection" | "pii" | "secrets" | "toxicity" | "leakage">;
}

export interface LoadOutcome {
  loaded: boolean;
  reason: string;
}

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













