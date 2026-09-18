// Chat routes — the agent run endpoints.

import { Router } from "express";
import { chatController, chatStreamController, type ChatControllerDeps } from "../controllers/chat.controller.ts";
import { asyncRoute } from "../utils/http.ts";

export function chatRoutes(deps: ChatControllerDeps): Router {
  const router = Router();
  router.post("/chat", asyncRoute(chatController(deps)));
  router.post("/chat/stream", asyncRoute(chatStreamController(deps)));
  return router;
}
