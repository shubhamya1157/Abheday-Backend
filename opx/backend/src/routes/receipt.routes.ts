// Receipt routes — verify and render Trust Receipts.

import { Router } from "express";
import { renderReceiptController, verifyReceiptController } from "../controllers/receipt.controller.ts";

export function receiptRoutes(): Router {
  const router = Router();
  router.post("/receipt/verify", verifyReceiptController());
  router.post("/receipt/render", renderReceiptController());
  return router;
}
