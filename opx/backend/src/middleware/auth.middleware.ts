// Bearer-token authentication.
//
// Before any request reaches a controller, check the Authorization header.
// When no token is configured the server is loopback-only (config refuses to
// start network-exposed without one), so auth is a no-op in that mode.
//
// The comparison is TIMING-SAFE: a plain `!==` leaks how many leading bytes
// matched via response time, which is enough to recover a token byte by byte.
// timingSafeEqual compares in constant time.

import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { AppConfig } from "../config/index.ts";
import type { Logger } from "../services/agent/harness.ts";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length differs → not equal, but still compare to keep timing uniform.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function authMiddleware(config: AppConfig, log: Logger): RequestHandler {
  const expected = config.http.authToken;

  if (expected === undefined) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const supplied = match?.[1] ?? "";

    if (!safeEqual(supplied, expected)) {
      log("warn", "rejected unauthenticated request", { path: req.path, ip: req.ip });
      res.status(401).json({ error: "missing or invalid bearer token" });
      return;
    }
    next();
  };
}
