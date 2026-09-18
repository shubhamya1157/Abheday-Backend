/**
 * Adapter for the OPTIONAL external @llm-guardrails/core engine.
 *
 * The built-in guards (injection, secrets, tool-policy, protected-paths) are the
 * always-on core and need no dependencies. This engine is an *enhancement* layered
 * on top when the package is installed.
 *
 * Two rules make it safe on a locked-down box:
 *
 * 1. OPTIONAL LOADING. The package is imported DYNAMICALLY, inside a try/catch.
 *    A top-level import of a missing optional dependency would crash the whole
 *    process at boot. Here a failed load is reported once and the pipeline simply
 *    runs with the built-in guards.
 *
 * 2. STAGE-AWARE. The engine is exposed as Guard objects that declare which
 *    stages they run on, so inbound (user_input, tool_result) and outbound
 *    (model_output) checks are configured independently.
 */

import type { Guard, GuardInput, GuardStage, GuardVerdict } from "./interface.guardrails.ts";

/** Custom terms the secrets/leakage guards must never let escape (MRPL demo). */
export const MRPL_LEAKAGE_TERMS = [
  "MRPL_INTERNAL_KEY",
  "REFINERY_ROOT_PWD",
  "SCADA_MASTER_TOKEN",
  "PID_CONFIDENTIAL_SPEC",
];

export interface LoadOutcome {
  loaded: boolean;
  reason: string;
}

export interface LoadEngineConfig {
  /** Our config vocabulary; mapped to the engine's detection level below. */
  level: "relaxed" | "standard" | "strict";
  outputBlockStrategy: "sanitize" | "block";
  customLeakageTerms: string[];
}

/**
 * Minimal structural type for the engine, so this file type-checks whether or
 * not @llm-guardrails/core is installed. We only use these three members.
 */
interface GuardrailEngineLike {
  checkInput(text: string, ctx: { sessionId: string }): Promise<GuardrailResultLike>;
  checkOutput(text: string, ctx: { sessionId: string }): Promise<GuardrailResultLike>;
}

interface GuardrailResultLike {
  blocked?: boolean;
  sanitized?: string;
  reason?: string;
  guard?: string;
}

function mapLevel(level: LoadEngineConfig["level"]): "basic" | "standard" | "advanced" {
  if (level === "relaxed") return "basic";
  if (level === "strict") return "advanced";
  return "standard";
}

/**
 * Try to construct the external engine. Never throws — returns a null engine and
 * a reason when the package is absent or fails its smoke test.
 */
export async function loadExternalEngine(
  config: LoadEngineConfig,
): Promise<{ engine: GuardrailEngineLike | null; outcome: LoadOutcome }> {
  let mod: { GuardrailEngine?: new (opts: unknown) => GuardrailEngineLike };
  try {
    // Dynamic + variable specifier so a missing package is a runtime miss, not a
    // hard module-resolution failure that takes the whole backend down at boot.
    const specifier = "@llm-guardrails/core";
    mod = (await import(specifier)) as typeof mod;
  } catch (err) {
    return {
      engine: null,
      outcome: {
        loaded: false,
        reason: `@llm-guardrails/core not installed (${err instanceof Error ? err.message : String(err)})`,
      },
    };
  }

  const Engine = mod.GuardrailEngine;
  if (typeof Engine !== "function") {
    return { engine: null, outcome: { loaded: false, reason: "package exports no GuardrailEngine" } };
  }

  try {
    const engine = new Engine({
      guards: ["injection", "pii", "secrets", "toxicity", "leakage"].map((name) => ({ name, enabled: true })),
      level: mapLevel(config.level),
      outputBlockStrategy: config.outputBlockStrategy,
      customLeakageTerms: config.customLeakageTerms,
      blockedMessage: "This message has been blocked by the guardrails.",
    });
    // Smoke-test both entry points so a broken build fails here, not mid-run.
    await engine.checkInput("healthcheck", { sessionId: "boot" });
    await engine.checkOutput("healthcheck", { sessionId: "boot" });
    return { engine, outcome: { loaded: true, reason: "loaded and smoke-tested" } };
  } catch (err) {
    return {
      engine: null,
      outcome: { loaded: false, reason: err instanceof Error ? err.message : "engine initialization failed" },
    };
  }
}

/**
 * Wrap a loaded engine as pipeline Guards.
 *
 *   checkInput  -> user_input and tool_result (both are untrusted INBOUND text)
 *   checkOutput -> model_output (leakage inspection on the way out)
 *
 * Routing tool_result through checkInput is deliberate: content read off disk is
 * inbound untrusted text and deserves the injection detector.
 */
export function externalEngineGuards(engine: GuardrailEngineLike): Guard[] {
  const inboundStages: GuardStage[] = ["user_input", "tool_result"];

  const toVerdict = (r: GuardrailResultLike): GuardVerdict => {
    if (r.blocked === true) {
      return { action: "block", reason: r.reason ?? `blocked by ${r.guard ?? "guardrail engine"}` };
    }
    if (typeof r.sanitized === "string") {
      return { action: "sanitize", text: r.sanitized, ...(r.reason ? { reason: r.reason } : {}) };
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
        if (verdict.action === "sanitize" && verdict.text === input.text) return { action: "allow" };
        return verdict;
      },
    },
    {
      name: "llm-guardrails:outbound",
      stages: ["model_output"],
      async check(input: GuardInput): Promise<GuardVerdict> {
        const r = await engine.checkOutput(input.text, { sessionId: input.sessionId });
        const verdict = toVerdict(r);
        if (verdict.action === "sanitize" && verdict.text === input.text) return { action: "allow" };
        return verdict;
      },
    },
  ];
}
