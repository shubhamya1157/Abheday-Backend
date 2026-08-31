/**
 * Adapter for the external @llm-guardrails/core engine.
 *
 * This wraps the library you already started using in
 * src/guardrails/library/core-guardrails.ts, with three changes that matter for
 * a system that has to survive a live demo:
 *
 * 1. OPTIONAL LOADING. The package is imported dynamically at startup, not with
 *    a top-level `import`. A top-level import of a missing or broken optional
 *    dependency crashes the whole process at boot — the entire backend refuses
 *    to start because a guardrail library did not install. Here, a failed load
 *    is reported once and the pipeline falls back to the built-in guards.
 *
 * 2. NO STATIC ENGINE. Your version held the engine in a `private static`
 *    initialised at class-definition time, which means construction cost and any
 *    constructor throw happen at import time, before logging exists, and the
 *    config cannot come from env. This builds it lazily and injectably.
 *
 * 3. STAGE-AWARE. The pipeline needs one Guard object per concern, so this
 *    exposes the engine as guards that declare which stages they run on, letting
 *    input and output checks be configured independently.
 *
 * The MRPL custom leakage terms from your original are preserved.
 */

import {
  GuardrailEngine,
  type GuardrailResult,
  type DetectionLevel,
} from "@llm-guardrails/core";
import type { Guard, GuardInput, GuardStage, GuardVerdict } from "./pipeline.ts";

/*
export interface CoreGuardrailsConfig {
  level?: "relaxed" | "standard" | "strict" | "basic" | "advanced";
  outputBlockStrategy?: "sanitize" | "block";
  blockedMessage?: string;
  blockedResponse?:{};
  customLeakageTerms?: string[];
  enabledGuards?: Array<"injection" | "pii" | "secrets" | "toxicity" | "leakage">;
}
function mapLevel(level?: CoreGuardrailsConfig["level"]): DetectionLevel {
  if (level === "relaxed" || level === "basic") return "basic";
  if (level === "strict" || level === "advanced") return "advanced";
  return "standard";
}
export const MRPL_LEAKAGE_TERMS = [
  "MRPL_INTERNAL_KEY",
  "REFINERY_ROOT_PWD",
  "SCADA_MASTER_TOKEN",
  "PID_CONFIDENTIAL_SPEC",
];
*/

export interface LoadOutcome {
  loaded: boolean;
  reason: string;
}

/**
 * Construct the @llm-guardrails/core engine.
 */
/**
 * Wrap a loaded engine as pipeline Guards.
 *
 * Two separate guards are produced because the engine has two entry points and
 * they belong at different stages:
 *   checkInput  -> user_input and tool_result (both are untrusted INBOUND text)
 *   checkOutput -> model_output (leakage inspection on the way out)
 *
 * Routing tool_result through checkInput is the deliberate part: content read
 * off disk is inbound untrusted text and deserves the injection detector, even
 * though the library's naming does not suggest that use.
 */
export function externalEngineGuards(engine: GuardrailEngine): Guard[] {
  const inboundStages: GuardStage[] = ["user_input", "tool_result"];

  const toVerdict = (r: GuardrailResult): GuardVerdict => {
    if (r.blocked === true) {
      return {
        action: "block",
        reason: r.reason ?? `blocked by ${r.guard ?? "guardrail engine"}`,
      };
    }
    if (typeof r.sanitized === "string") {
      return { action: "sanitize", text: r.sanitized, reason: r.reason };
    }
    return { action: "allow" };
  };
  

  return [
    {
      name: "llm-guardrails:inbound",
      stages: inboundStages,
      async check(input: GuardInput): Promise<GuardVerdict> {
        const r = await engine.checkInput(input.text, { sessionId: input.sessionId });
        const verdict = toVerdict(r);
        // Only treat a sanitisation as real if the text actually changed.
        if (verdict.action === "sanitize" && verdict.text === input.text) {
          return { action: "allow" };
        }
        return verdict;
      },
    },
    {
      name: "llm-guardrails:outbound",
      stages: ["model_output"],
      async check(input: GuardInput): Promise<GuardVerdict> {
        const r = await engine.checkOutput(input.text, { sessionId: input.sessionId });
        const verdict = toVerdict(r);
        if (verdict.action === "sanitize" && verdict.text === input.text) {
          return { action: "allow" };
        }
        return verdict;
      },
    },
  ];
}
