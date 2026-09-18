// Receipt controllers — what makes the Trust Receipt more than decoration.
//
//   POST /api/v1/receipt/verify   re-check a receipt's ordering and gaps
//   POST /api/v1/receipt/render   turn one into the Markdown a human reads
//
// The operator can hand a receipt back and independently confirm it, which is
// the point: the audit trail is verifiable, not just printed.

import type { Request, Response } from "express";
import { receiptToMarkdown, verifyReceipt, type TrustReceipt } from "../services/audit/receipt.ts";

function isReceipt(body: unknown): body is TrustReceipt {
  return body !== null && typeof body === "object" && Array.isArray((body as TrustReceipt).entries);
}

/** POST /api/v1/receipt/verify */
export function verifyReceiptController() {
  return (req: Request, res: Response): void => {
    const body: unknown = req.body;
    if (body === null || typeof body !== "object") {
      res.status(400).json({ error: "body must be a Trust Receipt object" });
      return;
    }
    if (!isReceipt(body)) {
      res.status(400).json({ error: "not a Trust Receipt: missing entries" });
      return;
    }
    const result = verifyReceipt(body);
    res.status(result.valid ? 200 : 422).json(result);
  };
}

/** POST /api/v1/receipt/render */
export function renderReceiptController() {
  return (req: Request, res: Response): void => {
    const body: unknown = req.body;
    if (!isReceipt(body)) {
      res.status(400).json({ error: "not a Trust Receipt" });
      return;
    }
    res.type("text/markdown").send(receiptToMarkdown(body));
  };
}
