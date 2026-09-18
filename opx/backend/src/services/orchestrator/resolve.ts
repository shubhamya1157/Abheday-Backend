// Per-run model routing.
//
// This is the "one default model that analyses the task and routes it to the
// best specialist" idea, made concrete:
//
//   raw user input
//        │  classifyTask()          → a TaskProfile (coding? vision? reasoning?)
//        ▼
//   CapabilityRouter.route()        → the best-fit ModelDescriptor
//        ▼
//   { modelId, reason, task }       → the harness swaps in that model's provider
//
// It never throws. If routing is disabled, no model fits, or anything goes
// wrong, it returns the default/planner model — a run that picks a slightly
// sub-optimal model is fine; a run that crashes because routing failed is not.

import { CapabilityRouter } from "./router.ts";
import { classifyTask } from "./task-analyzer.ts";
import type { ExecutionContext, ModelDescriptor, TaskProfile } from "./types.ts";

export interface RouteResult {
  modelId: string;
  /** Human-readable reasons, surfaced in the boot log and the trust receipt. */
  reason: string[];
  task: TaskProfile;
  /** True when the router chose; false when we fell back to the default. */
  routed: boolean;
}

export interface RoutingOptions {
  enabled: boolean;
  defaultModelId: string;
}

/**
 * Decide which model should handle this input.
 *
 * @param descriptors  every enabled model (from ModelRegistry.descriptors())
 * @param input        the raw user message
 * @param sessionId    used only to build the ExecutionContext the router wants
 */
export function resolveModel(
  descriptors: ModelDescriptor[],
  input: string,
  sessionId: string,
  opts: RoutingOptions,
): RouteResult {
  const task = classifyTask(input);

  if (!opts.enabled) {
    return { modelId: opts.defaultModelId, reason: ["routing disabled"], task, routed: false };
  }

  try {
    const router = new CapabilityRouter(descriptors);
    const context: ExecutionContext = {
      runId: sessionId,
      request: { userInput: input, sessionId },
      task,
      messages: [{ role: "user", content: input }],
      observations: [],
      toolCalls: [],
      artifacts: [],
      metadata: {},
      status: "pending",
    };
    const decision = router.decision(task, context);
    return {
      modelId: decision.selected.id,
      reason: decision.reason,
      task,
      routed: true,
    };
  } catch (err) {
    // No compatible model — fall back to the planner rather than fail the run.
    return {
      modelId: opts.defaultModelId,
      reason: [
        `no specialist model matched (${err instanceof Error ? err.message : String(err)}); using default`,
      ],
      task,
      routed: false,
    };
  }
}
