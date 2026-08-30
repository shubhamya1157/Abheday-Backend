// HTTP layer — Express, with SSE streaming.

import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import { z } from "zod";

import type { AgentEvent } from "../agent/events.ts";
import type { Harness } from "../agent/harness.ts";
import { receiptToMarkdown, verifyReceipt, type TrustReceipt } from "../audit/receipt.ts";
import type { AppConfig } from "../config.ts";
import { AgentError, type Message } from "../core/types.ts";
import type { Logger } from "../agent/harness.ts";

export interface ServerDeps {
  harness: Harness;
  config: AppConfig;
  log?: Logger;
}

export function createServer(deps: ServerDeps): Express {
  const { harness, config } = deps;
  const log = deps.log ?? (() => {});
  const app = express();

  // app.disable("x-powered-by");

  // Bound the body: the input cap is enforced per field below, but a 500MB body
  // should be rejected before it is ever parsed.

  app.use(express.json())
  // app.use(express.json({ limit: Math.max(1, Math.ceil(config.http.maxInputChars / 1000) + 256) + "kb" }));

  if (config.http.corsOrigins.length > 0) {
    app.use(corsMiddleware(config.http.corsOrigins));
  }

 



  app.use(authMiddleware(config, log));














  

  app.get("/v1/tools", (_req, res) => {
    res.json({ tools: harness.registry.schemas() });
  });

  /** The composed system prompt. Useful for review; it contains no secrets. */
  app.get("/v1/system-prompt", (_req, res) => {
    res.type("text/plain").send(harness.systemPrompt);
  });

  /* --- Non-streaming run ------------------------------------------------ */

  app.post("/v1/chat", asyncRoute(async (req, res) => {
    const parsed = parseRunBody(req.body, config);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
      const result = await harness.runToCompletion({
        input: parsed.input,
        sessionId: parsed.sessionId,
        signal: controller.signal,
        ...(parsed.history ? { history: parsed.history } : {}),
      });

      res.json({
        runId: result.outcome.runId,
        text: result.outcome.text,
        stopReason: result.outcome.stopReason,
        steps: result.outcome.steps,
        toolCalls: result.outcome.toolCallCount,
        usage: result.outcome.usage,
        durationMs: result.outcome.durationMs,
        ...(result.outcome.error ? { error: result.outcome.error } : {}),
        receipt: {
          entries: result.receipt.entries.length,
          verified: verifyReceipt(result.receipt).valid,
          stats: result.receipt.stats,
          ...(result.receiptPath ? { path: result.receiptPath } : {}),
        },
      });
    } catch (err) {
      sendError(res, err, log);
    }
  }));

  /* --- Streaming run ---------------------------------------------------- */

  app.post("/v1/chat/stream", asyncRoute(async (req, res) => {
    const parsed = parseRunBody(req.body, config);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const controller = new AbortController();
    let closed = false;

    // Cancellation. Without this a closed tab leaves the model generating.
    req.on("close", () => {
      closed = true;
      controller.abort();
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      if (closed) return;
      // Every newline in the payload must be its own `data:` line or the frame
      // is silently truncated at the first one. JSON.stringify has no raw
      // newlines, but the split is kept so this stays correct if that changes.
      const body = JSON.stringify(data)
        .split("\n")
        .map((l) => `data: ${l}`)
        .join("\n");
      res.write(`event: ${event}\n${body}\n\n`);
    };

    try {
      const it = harness.run({
        input: parsed.input,
        sessionId: parsed.sessionId,
        signal: controller.signal,
        ...(parsed.history ? { history: parsed.history } : {}),
        ...(parsed.stream === false ? { loopOverrides: { stream: false } } : { loopOverrides: { stream: true } }),
      });

      while (true) {
        const next = await it.next();
        if (next.done) {
          send("receipt", {
            runId: next.value.receipt.runId,
            entries: next.value.receipt.entries.length,
            verified: verifyReceipt(next.value.receipt).valid,
            stats: next.value.receipt.stats,
            ...(next.value.receiptPath ? { path: next.value.receiptPath } : {}),
          });
          send("done", next.value.outcome);
          break;
        }
        send(eventName(next.value), next.value);
      }
    } catch (err) {
      log("error", "stream failed", { error: err instanceof Error ? err.message : String(err) });
      send("error", errorPayload(err));
    } finally {
      if (!closed) res.end();
    }
  }));

  /* --- Receipt verification -------------------------------------------- */

  /**
   * Verify a receipt someone hands back. This is what makes the receipt more
   * than decoration: the operator can check it independently, and so can we.
   */
  app.post("/v1/receipt/verify", (req, res) => {
    const body: unknown = req.body;
    if (body === null || typeof body !== "object") {
      res.status(400).json({ error: "body must be a Trust Receipt object" });
      return;
    }
    const receipt = body as TrustReceipt;
    if (!Array.isArray(receipt.entries)) {
      res.status(400).json({ error: "not a Trust Receipt: missing entries" });
      return;
    }
    const result = verifyReceipt(receipt);
    res.status(result.valid ? 200 : 422).json(result);
  });

  /** Render a receipt as the Markdown a human reads. */
  app.post("/v1/receipt/render", (req, res) => {
    const body: unknown = req.body;
    if (body === null || typeof body !== "object" || !Array.isArray((body as TrustReceipt).entries)) {
      res.status(400).json({ error: "not a Trust Receipt" });
      return;
    }
    res.type("text/markdown").send(receiptToMarkdown(body as TrustReceipt));
  });

  






  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

 
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log("error", "unhandled route error", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(res, err, log);
  });

  return app;
}







//Before allowing a request to reach the API/agent, check whether the request contains the correct Bearer authentication token. 
// If correct → continue. If wrong/missing → return HTTP 401.

function authMiddleware(config: AppConfig, log: Logger): RequestHandler {
  const expected = config.http.authToken;
  if (expected === undefined) {
    // No token configured — only reachable on loopback.
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const supplied = match?.[1] ?? "";

    // Simple string comparison
    if (supplied !== expected) {
      log("warn", "rejected unauthenticated request", { path: req.path, ip: req.ip });
      res.status(401).json({ error: "missing or invalid bearer token" });
      return;
    }
    next();
  };
}









function corsMiddleware(origins: readonly string[]): RequestHandler {
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

/** Wrap an async handler so a rejection reaches Express instead of the process. */
function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/* ------------------------------------------------------------------------- */
/* Request parsing                                                          */
/* ------------------------------------------------------------------------- */

// --- Zod schemas for request body validation ---

// "system" is rejected: the system prompt is the agent's behavioural
// contract and a client must not be able to append to or override it.
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"], {
    message: 'role must be user, assistant, or tool',
  }),
  content: z.string({ message: 'content must be a string' }),
});

const RunBodySchema = z.object({
  // Accept input / message / prompt — all mean the same thing
  input:        z.string().min(1, '"input" is required and must be a non-empty string').optional(),
  message:      z.string().min(1).optional(),
  prompt:       z.string().min(1).optional(),
  sessionId:    z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/, '"sessionId" may contain only letters, digits, and _ . : -').optional(),
  history:      z.array(MessageSchema).optional(),
  stream:       z.boolean({ message: '"stream" must be a boolean' }).optional(),
});

interface ParsedRunBody {
  input: string;
  sessionId: string;
  history?: Message[];
  stream?: boolean;
}

function parseRunBody(body: unknown, config: AppConfig): ParsedRunBody | { error: string } {
  const result = RunBodySchema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "invalid request body" };
  }

  const b = result.data;

  // Accept input / message / prompt aliases
  const input = b.input ?? b.message ?? b.prompt;
  if (!input || input.trim().length === 0) {
    return { error: '"input" is required and must be a non-empty string' };
  }
  if (input.length > config.http.maxInputChars) {
    return { error: `"input" is ${input.length} characters; the limit is ${config.http.maxInputChars}` };
  }

  // Auto-generate a sessionId if the client didn't send one
  const sessionId = b.sessionId ?? `sess_${Date.now().toString(36)}`;

  return {
    input,
    sessionId,
    ...(b.history ? { history: b.history as Message[] } : {}),
    ...(b.stream !== undefined ? { stream: b.stream } : {}),
  };
}


function eventName(e: AgentEvent): string {
  return e.type;
}

function errorPayload(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof AgentError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: "INTERNAL",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}







// it figures out why something failed, picks the right HTTP error code, 
// and sends back a clean response instead of a confusing raw exception.


function sendError(res: Response, err: unknown, log: Logger): void {
  const payload = errorPayload(err);

  let status: number;
  if (payload.code === "EGRESS_BLOCKED" || payload.code === "GUARDRAIL_BLOCKED") {
    status = 403; // Forbidden — blocked by egress guard or guardrail
  } else if (payload.code === "PROVIDER_UNREACHABLE") {
    status = 503; // Service Unavailable — model server is down
  } else if (payload.code === "PROVIDER_TIMEOUT") {
    status = 504; // Gateway Timeout — model took too long
  } else if (payload.code === "ABORTED") {
    status = 499; // Client closed the connection
  } else {
    status = 500; // Internal Server Error — unknown crash
  }

  log("error", "request failed", { ...payload, status });
  res.status(status).json({ error: payload });
}


