// src/api/payment.js
import express from "express";
import {
  createCheckout,
  payhereNotify,
  payhereReturn,
  payhereCancel,
  myPaymentStatus,
} from "../application/payment.js";

import { authenticate } from "./middlewares/authentication.js";

const router = express.Router();

// ✅ create checkout (student)
router.post("/checkout", authenticate, createCheckout);

// ✅ payhere callbacks (PayHere server calls notify_url)
router.post("/notify", payhereNotify);
router.get("/return", payhereReturn);
router.get("/cancel", payhereCancel);

// ✅ check unlock status (student)
router.get("/my/:paperId", authenticate, myPaymentStatus);

export default router;