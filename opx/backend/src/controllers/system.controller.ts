// System controllers — inspection and health, no agent run involved.
//
//   GET /api/v1/health          liveness + which model servers are reachable
//   GET /api/v1/models          the registered models and routing state
//   GET /api/v1/tools           the tool catalogue as advertised to the model
//   GET /api/v1/system-prompt   the composed system prompt (contains no secrets)

import type { Request, Response } from "express";
import type { Harness } from "../services/agent/harness.ts";

export interface SystemControllerDeps {
  harness: Harness;
}

/** GET /api/v1/health */
export function healthController(deps: SystemControllerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const health = await deps.harness.health();
    const boot = deps.harness.boot;
    res.status(health.reachable ? 200 : 503).json({
      status: health.reachable ? "ok" : "degraded",
      defaultModel: boot.defaultModel,
      models: boot.models,
      memoryEnabled: boot.memoryEnabled,
      egressEnforced: boot.egressEnforced,
      protocol: boot.protocolMode,
      health,
    });
  };
}

/** GET /api/v1/models */
export function modelsController(deps: SystemControllerDeps) {
  return (_req: Request, res: Response): void => {
    const boot = deps.harness.boot;
    res.json({
      defaultModel: boot.defaultModel,
      routingEnabled: boot.routingEnabled,
      models: boot.models,
    });
  };
}

/** GET /api/v1/tools */
export function toolsController(deps: SystemControllerDeps) {
  return (_req: Request, res: Response): void => {
    res.json({ tools: deps.harness.registry.schemas() });
  };
}

/** GET /api/v1/system-prompt */
export function systemPromptController(deps: SystemControllerDeps) {
  return (_req: Request, res: Response): void => {
    res.type("text/plain").send(deps.harness.systemPrompt);
  };
}
