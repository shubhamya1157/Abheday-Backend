// Small HTTP helpers shared by the controllers: request-body validation, error
// mapping, and an async-route wrapper. Kept out of the controllers so the
// request contract lives in one place.

import type { Request, RequestHandler, Response } from "express";
import * as z from "zod";
import type { AppConfig } from "../config/index.ts";
import { AgentError, type Message } from "../core/types.ts";
import type { Logger } from "../services/agent/harness.ts";

/** Wrap an async handler so a rejection reaches Express instead of the process. */
export function asyncRoute(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/* --- Request body validation --------------------------------------------- */

// "system" is rejected: the system prompt is the agent's behavioural contract
// and a client must not be able to append to or override it.
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"], { message: "role must be user, assistant, or tool" }),
  content: z.string({ message: "content must be a string" }),
});

const RunBodySchema = z.object({
  input: z.string().min(1, '"input" is required and must be a non-empty string').optional(),
  message: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/, '"sessionId" may contain only letters, digits, and _ . : -')
    .optional(),
  history: z.array(MessageSchema).optional(),
  stream: z.boolean({ message: '"stream" must be a boolean' }).optional(),
});

export interface ParsedRunBody {
  input: string;
  sessionId: string;
  history?: Message[];
  stream?: boolean;
}

export function parseRunBody(body: unknown, config: AppConfig): ParsedRunBody | { error: string } {
  const result = RunBodySchema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "invalid request body" };
  }
  const b = result.data;

  const input = b.input ?? b.message ?? b.prompt;
  if (!input || input.trim().length === 0) {
    return { error: '"input" is required and must be a non-empty string' };
  }
  if (input.length > config.http.maxInputChars) {
    return { error: `"input" is ${input.length} characters; the limit is ${config.http.maxInputChars}` };
  }

  const sessionId = b.sessionId ?? `sess_${Date.now().toString(36)}`;
  return {
    input,
    sessionId,
    ...(b.history ? { history: b.history as Message[] } : {}),
    ...(b.stream !== undefined ? { stream: b.stream } : {}),
  };
}

/* --- Error mapping ------------------------------------------------------- */

export function errorPayload(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof AgentError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: "INTERNAL",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

/**
 * Map an error to an HTTP status and send it. Blocked-by-policy is 403 (the
 * request was understood and refused), model down is 503, timeout 504.
 */
export function sendError(res: Response, err: unknown, log: Logger): void {
  const payload = errorPayload(err);

  let status: number;
  if (payload.code === "EGRESS_BLOCKED" || payload.code === "GUARDRAIL_BLOCKED") {
    status = 403;
  } else if (payload.code === "PROVIDER_UNREACHABLE") {
    status = 503;
  } else if (payload.code === "PROVIDER_TIMEOUT") {
    status = 504;
  } else if (payload.code === "ABORTED") {
    status = 499;
  } else {
    status = 500;
  }

  log("error", "request failed", { ...payload, status });
  res.status(status).json({ error: payload });
}
