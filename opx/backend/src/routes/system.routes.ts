// System routes — health, model registry, tool catalogue, system prompt.

import { Router } from "express";
import {
  healthController,
  modelsController,
  systemPromptController,
  toolsController,
  type SystemControllerDeps,
} from "../controllers/system.controller.ts";
import { asyncRoute } from "../utils/http.ts";

export function systemRoutes(deps: SystemControllerDeps): Router {
  const router = Router();
  router.get("/health", asyncRoute(healthController(deps)));
  router.get("/models", modelsController(deps));
  router.get("/tools", toolsController(deps));
  router.get("/system-prompt", systemPromptController(deps));
  return router;
}
