// Express app assembly.
//
// This is the composition root for the HTTP layer: it wires middleware →
// routes → error handling in the right order and returns a ready app. It does
// NOT listen (server.ts does) so the same app can be imported by tests and
// mounted without opening a port.
//
// Order matters: body parsing and CORS before auth, auth before routes, the
// 404 and error handlers last.

import express, { type Express, type NextFunction, type Request, type Response } from "express";

import type { AppConfig } from "./config/index.ts";
import type { Harness, Logger } from "./services/agent/harness.ts";
import { authMiddleware } from "./middleware/auth.middleware.ts";
import { corsMiddleware } from "./middleware/cors.middleware.ts";
import { chatRoutes } from "./routes/chat.routes.ts";
import { receiptRoutes } from "./routes/receipt.routes.ts";
import { systemRoutes } from "./routes/system.routes.ts";
import { sendError } from "./utils/http.ts";

export interface AppDeps {
  harness: Harness;
  config: AppConfig;
  log?: Logger;
}

const API_PREFIX = "/api/v1";

export function createApp(deps: AppDeps): Express {
  const { harness, config } = deps;
  const log = deps.log ?? (() => {});
  const app = express();

  // Do not advertise the framework.
  app.disable("x-powered-by");

  // Bound the body before parsing: the per-field input cap is enforced later,
  // but a giant body should be rejected up front. Derive a kb limit from the
  // char cap with generous headroom for JSON overhead.
  const bodyLimitKb = Math.max(64, Math.ceil(config.http.maxInputChars / 1000) + 256);
  app.use(express.json({ limit: `${bodyLimitKb}kb` }));

  if (config.http.corsOrigins.length > 0) {
    app.use(corsMiddleware(config.http.corsOrigins));
  }

  app.use(authMiddleware(config, log));

  // Feature routes, all under /api/v1.
  app.use(API_PREFIX, systemRoutes({ harness }));
  app.use(API_PREFIX, chatRoutes({ harness, config, log }));
  app.use(API_PREFIX, receiptRoutes());

  // 404 for anything else.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  // Central error handler — last, four-arg signature so Express treats it as one.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log("error", "unhandled route error", { error: err instanceof Error ? err.message : String(err) });
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(res, err, log);
  });

  return app;
}
