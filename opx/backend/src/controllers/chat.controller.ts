// Chat controllers — the two ways to run the agent.
//
//   POST /api/v1/chat          run to completion, return one JSON object
//   POST /api/v1/chat/stream   run with Server-Sent Events, one frame per step
//
// Both parse and validate the body the same way, both cancel the run when the
// client disconnects, and both surface which model routing chose.

import type { Request, Response } from "express";
import type { AppConfig } from "../config/index.ts";
import type { Harness, Logger } from "../services/agent/harness.ts";
import { verifyReceipt } from "../services/audit/receipt.ts";
import type { AgentEvent } from "../services/agent/events.ts";
import { parseRunBody, sendError, errorPayload } from "../utils/http.ts";

export interface ChatControllerDeps {
  harness: Harness;
  config: AppConfig;
  log: Logger;
}

/** POST /api/v1/chat — non-streaming. */
export function chatController(deps: ChatControllerDeps) {
  const { harness, config, log } = deps;

  return async (req: Request, res: Response): Promise<void> => {
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
        model: result.routing.modelId,
        routing: { routed: result.routing.routed, reason: result.routing.reason, task: result.routing.task.taskType },
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
  };
}

/** POST /api/v1/chat/stream — Server-Sent Events. */
export function chatStreamController(deps: ChatControllerDeps) {
  const { harness, config, log } = deps;

  return async (req: Request, res: Response): Promise<void> => {
    const parsed = parseRunBody(req.body, config);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const controller = new AbortController();
    let closed = false;
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
      // Each newline in the payload must be its own `data:` line or the frame is
      // silently truncated at the first newline.
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
        loopOverrides: { stream: parsed.stream !== false },
      });

      while (true) {
        const next = await it.next();
        if (next.done) {
          send("receipt", {
            runId: next.value.receipt.runId,
            entries: next.value.receipt.entries.length,
            verified: verifyReceipt(next.value.receipt).valid,
            stats: next.value.receipt.stats,
            model: next.value.routing.modelId,
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
  };
}

function eventName(e: AgentEvent): string {
  return e.type;
}
