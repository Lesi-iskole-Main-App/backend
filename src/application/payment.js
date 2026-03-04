// src/application/payment.js
import crypto from "crypto";
import mongoose from "mongoose";
import Paper from "../infastructure/schemas/paper.js";
import Payment from "../infastructure/schemas/payment.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const md5 = (s) =>
  crypto.createHash("md5").update(String(s || ""), "utf8").digest("hex");

const PAYHERE_MODE = String(process.env.PAYHERE_MODE || "sandbox")
  .trim()
  .toLowerCase(); // sandbox | live

const PAYHERE_CURRENCY = String(process.env.PAYHERE_CURRENCY || "LKR")
  .trim()
  .toUpperCase();

const PAYHERE_MERCHANT_ID = String(process.env.PAYHERE_MERCHANT_ID || "").trim();
const PAYHERE_MERCHANT_SECRET = String(process.env.PAYHERE_MERCHANT_SECRET || "").trim();

// ✅ if you set PAYHERE_GATEWAY_URL manually, it will override mode selection
const PAYHERE_GATEWAY_URL = String(process.env.PAYHERE_GATEWAY_URL || "").trim()
  ? String(process.env.PAYHERE_GATEWAY_URL).trim()
  : PAYHERE_MODE === "live"
  ? "https://www.payhere.lk/pay/checkout"
  : "https://sandbox.payhere.lk/pay/checkout";

// ✅ used for return/cancel/notify urls
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim();
if (!PUBLIC_BASE_URL) console.error("[PayHere] PUBLIC_BASE_URL is not set — notify/return/cancel URLs will be broken!");

// Startup validation
if (!PAYHERE_MERCHANT_ID || !PAYHERE_MERCHANT_SECRET) {
  console.error("[PayHere] MISSING ENV VARS — payments will fail!");
  console.error("[PayHere] PAYHERE_MERCHANT_ID set:", !!PAYHERE_MERCHANT_ID);
  console.error("[PayHere] PAYHERE_MERCHANT_SECRET set:", !!PAYHERE_MERCHANT_SECRET);
} else {
  console.log(`[PayHere] Initialized — mode: ${PAYHERE_MODE}, merchant_id: ${PAYHERE_MERCHANT_ID}, gateway: ${PAYHERE_GATEWAY_URL}`);
}

// if true => skip md5sig verification (not recommended for production)
const PAYHERE_DISABLE_HASH =
  String(process.env.PAYHERE_DISABLE_HASH || "").toLowerCase() === "true";

// hash = MD5( merchant_id + order_id + amount + currency + MD5(secret).toUpperCase() ).toUpperCase()
function makePayhereHash({ merchant_id, order_id, amount, currency }) {
  const secret = md5(PAYHERE_MERCHANT_SECRET).toUpperCase();
  const amt = Number(amount || 0).toFixed(2);
  const raw = `${merchant_id}${order_id}${amt}${currency}${secret}`;
  const hash = md5(raw).toUpperCase();

  console.log("[PayHere Hash Debug]", {
    merchant_id,
    order_id,
    amount: amt,
    currency,
    mode: PAYHERE_MODE,
    secret_set: !!PAYHERE_MERCHANT_SECRET,
    secret_length: PAYHERE_MERCHANT_SECRET.length,
    hash,
  });

  return hash;
}

// md5sig = MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + MD5(secret).toUpperCase()).toUpperCase()
function verifyPayhereMd5Sig(payload) {
  try {
    const merchant_id = String(payload?.merchant_id || "");
    const order_id = String(payload?.order_id || "");

    // PayHere sends decimals, make sure we compare as fixed(2)
    const payhere_amount = Number(payload?.payhere_amount || payload?.amount || 0).toFixed(2);

    const payhere_currency = String(payload?.payhere_currency || payload?.currency || "");
    const status_code = String(payload?.status_code || payload?.statusCode || "");

    const secret = md5(PAYHERE_MERCHANT_SECRET).toUpperCase();
    const raw = `${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${secret}`;
    const local = md5(raw).toUpperCase();

    const remote = String(payload?.md5sig || payload?.md5Sig || "").toUpperCase();
    if (!remote) return { ok: false, reason: "md5sig missing" };

    return { ok: local === remote, local, remote };
  } catch (e) {
    return { ok: false, reason: e?.message || "verify error" };
  }
}

/**
 * POST /api/payment/checkout
 * body: { paperId }
 * returns: { unlocked:true } OR { gatewayUrl, fields }
 */
export const createCheckout = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { paperId } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!isValidId(paperId)) return res.status(400).json({ message: "Valid paperId is required" });

    const paper = await Paper.findById(paperId).lean();
    if (!paper || !paper.isActive || !paper.isPublished) {
      return res.status(404).json({ message: "Paper not available" });
    }

    const payType = String(paper.payment || "free").toLowerCase();
    if (payType !== "paid") {
      return res.status(400).json({ message: "This paper is not a paid paper" });
    }

    if (!PAYHERE_MERCHANT_ID || !PAYHERE_MERCHANT_SECRET) {
      return res.status(500).json({ message: "PayHere keys not configured" });
    }

    // ✅ if already paid, return unlocked (DO NOT return empty gatewayUrl)
    const alreadyPaid = await Payment.findOne({
      userId,
      paperId,
      status: { $in: ["completed", "success"] },
    }).lean();

    if (alreadyPaid) {
      return res.status(200).json({
        unlocked: true,
        message: "Already paid",
      });
    }

    const amount = Number(paper.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Paper amount invalid" });
    }

    const orderId = `LESI-${paperId}-${userId}-${Date.now()}`;

    await Payment.create({
      userId,
      paperId,
      orderId,
      currency: PAYHERE_CURRENCY,
      amount,
      status: "pending",
      statusCode: 0,
      payherePaymentId: "",
      method: "",
      md5sig: "",
      raw: { paperTitle: paper.paperTitle || "", mode: PAYHERE_MODE },
    });

    const fields = {
      merchant_id: PAYHERE_MERCHANT_ID,

      return_url: `${PUBLIC_BASE_URL}/api/payment/return?order_id=${encodeURIComponent(orderId)}`,
      cancel_url: `${PUBLIC_BASE_URL}/api/payment/cancel?order_id=${encodeURIComponent(orderId)}`,
      notify_url: `${PUBLIC_BASE_URL}/api/payment/notify`,

      order_id: orderId,
      items: String(paper.paperTitle || "Paper"),
      currency: PAYHERE_CURRENCY,
      amount: Number(amount).toFixed(2),

      first_name: String(req.user?.name || "Student"),
      last_name: "",
      email: String(req.user?.email || "student@example.com"),
      phone: String(req.user?.phone || ""),
      address: "",
      city: "",
      country: "Sri Lanka",
    };

    const hash = makePayhereHash({
      merchant_id: fields.merchant_id,
      order_id: fields.order_id,
      amount: fields.amount,
      currency: fields.currency,
    });

    return res.status(200).json({
      gatewayUrl: PAYHERE_GATEWAY_URL, // ✅ sandbox/live correct now
      fields: { ...fields, hash },
      mode: PAYHERE_MODE,
    });
  } catch (err) {
    console.error("createCheckout error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/payment/notify
 * PayHere server POSTs x-www-form-urlencoded
 */
export const payhereNotify = async (req, res) => {
  try {
    const payload = req.body || {};

    const orderId = String(payload?.order_id || "");
    if (!orderId) return res.status(400).send("order_id missing");

    const statusCode = Number(payload?.status_code || payload?.statusCode || 0);
    const payherePaymentId = String(payload?.payment_id || payload?.payherePaymentId || "");
    const method = String(payload?.method || "");

    // ✅ verify md5sig unless disabled
    if (!PAYHERE_DISABLE_HASH) {
      const sig = verifyPayhereMd5Sig(payload);
      if (!sig.ok) {
        console.warn("PayHere md5sig invalid:", sig);
        await Payment.findOneAndUpdate(
          { orderId },
          {
            $set: {
              raw: payload,
              md5sig: String(payload?.md5sig || ""),
              status: "pending",
              statusCode: 0,
            },
          },
          { new: true }
        );
        return res.status(200).send("OK");
      }
    }

    // PayHere success is typically status_code = 2
    const success = statusCode === 2;
    const nextStatus = success ? "completed" : "failed";

    await Payment.findOneAndUpdate(
      { orderId },
      {
        $set: {
          payherePaymentId,
          method,
          status: nextStatus,
          statusCode,
          md5sig: String(payload?.md5sig || ""),
          raw: payload,
        },
      },
      { new: true }
    );

    return res.status(200).send("OK");
  } catch (err) {
    console.error("payhereNotify error:", err);
    return res.status(200).send("OK");
  }
};

export const payhereReturn = async (req, res) => {
  const orderId = String(req.query?.order_id || "");
  return res
    .status(200)
    .send(
      `<html><body><h3>Payment Completed</h3><p>You can close this page.</p><p>${orderId}</p></body></html>`
    );
};

export const payhereCancel = async (req, res) => {
  const orderId = String(req.query?.order_id || "");
  return res
    .status(200)
    .send(
      `<html><body><h3>Payment Cancelled</h3><p>You can close this page.</p><p>${orderId}</p></body></html>`
    );
};

/**
 * GET /api/payment/my/:paperId
 * returns: { required, unlocked, status, statusCode }
 */
export const myPaymentStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { paperId } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!isValidId(paperId)) return res.status(400).json({ message: "Invalid paperId" });

    const paper = await Paper.findById(paperId).select("_id payment amount").lean();
    if (!paper) return res.status(404).json({ message: "Paper not found" });

    const payType = String(paper.payment || "free").toLowerCase();
    if (payType !== "paid") {
      return res
        .status(200)
        .json({ required: false, unlocked: true, status: "not_required", statusCode: 0 });
    }

    const p = await Payment.findOne({ userId, paperId })
      .sort({ createdAt: -1 })
      .select("status statusCode orderId payherePaymentId amount currency")
      .lean();

    const status = String(p?.status || "pending");
    const unlocked = ["completed", "success"].includes(status);

    return res.status(200).json({
      required: true,
      unlocked,
      status,
      statusCode: Number(p?.statusCode || 0),
      orderId: p?.orderId || "",
      payherePaymentId: p?.payherePaymentId || "",
      amount: Number(p?.amount || paper.amount || 0),
      currency: p?.currency || PAYHERE_CURRENCY,
    });
  } catch (err) {
    console.error("myPaymentStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};