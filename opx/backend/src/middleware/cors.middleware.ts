// CORS — only installed when CORS_ORIGINS is set (a browser frontend on another
// origin). Left off, the API is same-origin / tool-only, which is the tighter
// default for a sovereign box. Origins are matched against an explicit allowlist;
// there is no wildcard.

import type { RequestHandler } from "express";

export function corsMiddleware(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
