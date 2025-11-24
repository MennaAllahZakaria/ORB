const axios = require("axios");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");

const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const { addPoints } = require("./pointsService");

// ===============================
// 🔧 CONSTANTS & BASIC VALIDATION
// ===============================

// Lesson-level payment status (matches lessonSchema enum)
const LESSON_PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PENDING: "pending",
  PAID: "paid",
  HELD: "held",
  RELEASED: "released",
  REFUNDED: "refunded",
};

// Gateway transaction-level status (matches paymentSchema.enum)
const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  RELEASED: "released",
  REFUNDED: "refunded",
};

const PAYMOB_BASE = process.env.PAYMOB_API_URL || "https://accept.paymob.com/api";

const PAYMOB_REQUIRED_ENV_VARS = [
  "PAYMOB_API_URL",
  "PAYMOB_API_KEY",
  "PAYMOB_IFRAME_ID",
  "PAYMOB_CARD_INTEGRATION_ID",
  "PAYMOB_WALLET_INTEGRATION_ID",
  "PAYMOB_HMAC_SECRET",
];

PAYMOB_REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`[Paymob][Config] Missing env var: ${key}`);
  }
});

// ===============================
// INTERNAL HELPER (used by route + other modules)
// ===============================

/**
 * Internal helper to release payout to teacher via Paymob.
 * - Assumes lesson.paymentStatus === PAID and lesson.status === completed.
 * - Used by the route and can be reused from other controllers (e.g. Zego callback).
 */
async function releasePaymentForLesson(lesson) {
  // Ensure acceptedTeacher is populated
  if (!lesson.populated || !lesson.populated("acceptedTeacher")) {
    lesson = await Lesson.findById(lesson._id).populate("acceptedTeacher");
    if (!lesson) throw new Error("Lesson not found during payout");
  }

  if (!lesson.acceptedTeacher) {
    throw new Error("No accepted teacher for this lesson");
  }

  // Idempotency: if already released, do nothing
  if (lesson.paymentStatus === LESSON_PAYMENT_STATUS.RELEASED) {
    return {
      alreadyReleased: true,
      message: "Payment already released",
    };
  }

  if (lesson.paymentStatus !== LESSON_PAYMENT_STATUS.PAID) {
    throw new Error("Payment is not in PAID state, cannot release payout");
  }

  const teacher = lesson.acceptedTeacher;
  const payoutRecipientId =
    teacher?.teacherProfile?.paymentInfo?.payoutRecipientId;

  if (!payoutRecipientId) {
    throw new Error("Teacher has no payoutRecipientId");
  }

  // Fees configuration
  const platformFeePercentage = 0.20; // 20% platform
  const gatewayFeePercentage = 0.03; // 3% gateway
  const totalFeePercentage = platformFeePercentage + gatewayFeePercentage;

  const totalAmount = lesson.price;
  const teacherAmount = totalAmount * (1 - totalFeePercentage);
  const platformFeeAmount = totalAmount * platformFeePercentage;
  const gatewayFeeAmount = totalAmount * gatewayFeePercentage;

  // 🔁 Call Paymob payout API
  const { data: payout } = await axios.post(
    `${PAYMOB_BASE}/acceptance/payout`,
    {
      amount: Math.round(teacherAmount * 100), // in cents
      currency: "EGP",
      recipient: payoutRecipientId,
      description: `Payout for lesson ${lesson._id} (after fees)`,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYMOB_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  // 💾 Update lesson with payout info
  lesson.paymentStatus = LESSON_PAYMENT_STATUS.RELEASED;
  lesson.teacherPayoutId = payout.id;
  lesson.payment = {
    ...lesson.payment,
    amount: totalAmount,
    status: PAYMENT_STATUS.RELEASED,
  };
  lesson.amountPaid = teacherAmount;

  // Optional: requires 'fees' field in Lesson schema if you want to persist it
  lesson.fees = {
    platform: platformFeeAmount,
    gateway: gatewayFeeAmount,
  };

  await lesson.save();

  console.log(
    `✅ Payout released | lesson=${lesson._id} | teacher=${teacher._id} | amount=${teacherAmount} EGP`
  );

  return {
    payoutId: payout.id,
    totalAmount,
    teacherAmount,
    platformFee: platformFeeAmount,
    gatewayFee: gatewayFeeAmount,
  };
}

// Export helper so other modules (e.g. Zego callbacks) can reuse it if needed
exports._releasePaymentForLesson = releasePaymentForLesson;

// ===============================
// 1️⃣ INITIATE PAYMENT
// ===============================
// @route   POST /payments/lessons/:lessonId/initiate
// @access  Private (student)
exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { paymentMethod = "card", walletPhone, walletProvider } = req.body;

  const lesson = await Lesson.findById(lessonId).populate("student");
  if (!lesson) throw new ApiError("Lesson not found", 404);

  // Only the lesson owner (student) can pay for it
  if (lesson.student._id.toString() !== req.user._id.toString()) {
    throw new ApiError("You are not allowed to pay for this lesson", 403);
  }

  // Check payment status / lesson status
  if (
    lesson.paymentStatus === LESSON_PAYMENT_STATUS.PAID ||
    lesson.paymentStatus === LESSON_PAYMENT_STATUS.RELEASED
  ) {
    throw new ApiError("Lesson is already paid or released", 400);
  }

  if (lesson.status === "canceled") {
    throw new ApiError("Cannot pay for a canceled lesson", 400);
  }

  // ✅ Validate payment method
  if (!["card", "wallet"].includes(paymentMethod)) {
    throw new ApiError("Invalid payment method", 400);
  }

  // Wallet-specific validation
  if (paymentMethod === "wallet" && !walletPhone) {
    throw new ApiError("walletPhone is required for wallet payments", 400);
  }

  const amountCents = Math.round(lesson.price * 100);
  let paymentLink = null;
  let redirectUrl = null;

  try {
    // 1️⃣ Auth token
    const { data: auth } = await axios.post(`${PAYMOB_BASE}/auth/tokens`, {
      api_key: process.env.PAYMOB_API_KEY,
    });

    // 2️⃣ Create order
    const { data: order } = await axios.post(
      `${PAYMOB_BASE}/ecommerce/orders`,
      {
        auth_token: auth.token,
        amount_cents: amountCents,
        currency: "EGP",
        merchant_order_id: lesson._id.toString(),
      }
    );

    // 3️⃣ Payment key
    const integrationId =
      paymentMethod === "wallet"
        ? process.env.PAYMOB_WALLET_INTEGRATION_ID
        : process.env.PAYMOB_CARD_INTEGRATION_ID;

    const { data: paymentKey } = await axios.post(
      `${PAYMOB_BASE}/acceptance/payment_keys`,
      {
        auth_token: auth.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: order.id,
        billing_data: {
          apartment: "NA",
          email: lesson.student.email,
          floor: "NA",
          first_name: lesson.student.firstName || "Student",
          last_name: lesson.student.lastName || "User",
          phone_number: lesson.student.phone || walletPhone || "NA",
          city: "Cairo",
          country: "EG",
          street: "NA",
          building: "NA",
          shipping_method: "NA",
          postal_code: "NA",
          state: "NA",
        },
        currency: "EGP",
        integration_id: integrationId,
      }
    );

    // 4️⃣ Card flow → IFrame link
    if (paymentMethod === "card") {
      paymentLink = `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey.token}`;
    }

    // 5️⃣ Wallet flow → call Paymob pay endpoint
    if (paymentMethod === "wallet") {
      const { data: walletRes } = await axios.post(
        `${PAYMOB_BASE}/acceptance/payments/pay`,
        {
          source: {
            identifier: walletPhone,
            // Adjust subtype according to your Paymob wallet configuration
            subtype: walletProvider || "WALLET",
          },
          payment_token: paymentKey.token,
        }
      );

      // Paymob may return a redirect_url for wallet confirmation
      redirectUrl = walletRes.redirect_url || null;

      // Optionally store transaction id from walletRes if available
      if (walletRes.id) {
        lesson.payment = {
          ...lesson.payment,
          transactionId: walletRes.id,
        };
      }
    }

    // 💾 Save payment info on lesson
    lesson.payment = {
      ...lesson.payment,
      amount: amountCents / 100,
      paymobOrderId: order.id,
      status: PAYMENT_STATUS.PENDING,
      method: paymentMethod,
      walletPhone: paymentMethod === "wallet" ? walletPhone : null,
      walletProvider: paymentMethod === "wallet" ? walletProvider || null : null,
    };

    lesson.paymentStatus = LESSON_PAYMENT_STATUS.PENDING;

    await lesson.save();
  } catch (err) {
    console.error(
      "❌ Paymob payment initiation failed:",
      err.response?.data || err.message
    );
    return next(new ApiError("Failed to initiate payment", 500));
  }

  return res.status(200).json({
    status: "success",
    paymentMethod,
    paymentLink, // for card payments
    redirectUrl, // for wallet payments (if provided by Paymob)
  });
});

// ===============================
// 2️⃣ HANDLE PAYMOB CALLBACK (WEBHOOK)
// ===============================
// @route   POST /payments/paymob/callback
// @access  Public (must be protected by IP/firewall on infra level)
exports.handlePaymentCallback = asyncHandler(async (req, res) => {
  try {
    const { obj, hmac } = req.body;

    if (!obj || !hmac) {
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    // Keys and order based on Paymob docs
    const sortedKeys = [
      "amount_cents",
      "created_at",
      "currency",
      "error_occured",
      "has_parent_transaction",
      "id",
      "integration_id",
      "is_3d_secure",
      "is_auth",
      "is_capture",
      "is_refunded",
      "is_standalone_payment",
      "is_voided",
      "order.id",
      "owner",
      "pending",
      "source_data.pan",
      "source_data.sub_type",
      "source_data.type",
      "success",
    ];

    const concatenatedString = sortedKeys
      .map((key) => {
        const keys = key.split(".");
        let value = obj;
        keys.forEach((k) => {
          value = value ? value[k] : undefined;
        });
        // Preserve false/0 – only null/undefined become empty string
        return value === null || value === undefined ? "" : value.toString();
      })
      .join("");

    const calculatedHmac = crypto
      .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
      .update(concatenatedString)
      .digest("hex");

    if (calculatedHmac !== hmac) {
      console.error("[Paymob][Callback] HMAC mismatch");
      return res.status(400).json({ message: "Invalid HMAC signature" });
    }

    const lessonId = obj.order?.merchant_order_id;
    if (!lessonId) {
      return res.status(400).json({ message: "Missing merchant_order_id" });
    }

    const lesson = await Lesson.findById(lessonId).populate("student");
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    // Validate amount to prevent tampering
    const expectedAmountCents = Math.round(lesson.price * 100);
    const receivedAmountCents = parseInt(obj.amount_cents, 10);

    if (receivedAmountCents !== expectedAmountCents) {
      console.error(
        "[Paymob][Callback] Amount mismatch",
        receivedAmountCents,
        "!==",
        expectedAmountCents
      );
      return res.status(400).json({ message: "Amount mismatch" });
    }

    // Optional: verify order.id matches paymobOrderId we stored
    if (
      lesson.payment?.paymobOrderId &&
      obj.order?.id &&
      String(obj.order.id) !== String(lesson.payment.paymobOrderId)
    ) {
      console.error(
        "[Paymob][Callback] Order ID mismatch",
        obj.order.id,
        "!=",
        lesson.payment.paymobOrderId
      );
      return res.status(400).json({ message: "Order ID mismatch" });
    }

    const isSuccess = !!obj.success;

    if (isSuccess) {
      // Idempotency: if already marked as paid or released, just acknowledge
      if (
        lesson.paymentStatus === LESSON_PAYMENT_STATUS.PAID ||
        lesson.paymentStatus === LESSON_PAYMENT_STATUS.RELEASED
      ) {
        return res
          .status(200)
          .json({ message: "Payment already processed previously" });
      }

      // Mark as paid
      lesson.paymentStatus = LESSON_PAYMENT_STATUS.PAID;
      lesson.status = "approved"; // adjust based on your business rules

      lesson.payment = {
        ...lesson.payment,
        status: PAYMENT_STATUS.PAID,
        transactionId: obj.id,
      };

      await lesson.save();

      // Add points for booking (non-critical: don't fail payment if this throws)
      if (lesson?.student?._id) {
        try {
          await addPoints(
            lesson.student._id,
            10,
            "Lesson booked successfully"
          );
        } catch (pointsErr) {
          console.error(
            "[Points] Failed to add points after successful payment:",
            pointsErr.message
          );
        }
      }
    } else {
      // Payment failed – update transaction status but keep lessonPaymentStatus consistent
      lesson.paymentStatus = LESSON_PAYMENT_STATUS.UNPAID;
      lesson.payment = {
        ...lesson.payment,
        status: PAYMENT_STATUS.FAILED,
      };
      await lesson.save();
    }

    res.status(200).json({ message: "Callback processed successfully" });
  } catch (err) {
    console.error("[Paymob][Callback] Error processing callback:", err);
    res.status(500).json({ message: "Error processing callback" });
  }
});

// ===============================
// 3️⃣ RELEASE PAYMENT TO TEACHER
// ===============================
// @route   POST /payments/lessons/:lessonId/release
// @access  Private (admin/system)
// Make sure route is protected with allowedTo('admin') or internal system auth.
exports.releasePaymentToTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  let lesson = await Lesson.findById(lessonId).populate("acceptedTeacher");
  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  // Business rule: lesson must be completed to trigger payout
  if (lesson.status !== "completed") {
    return next(
      new ApiError("Lesson must be completed before payout", 400)
    );
  }

  // Idempotency: if already released
  if (lesson.paymentStatus === LESSON_PAYMENT_STATUS.RELEASED) {
    return next(new ApiError("Payment already released", 400));
  }

  // Payment must be received from Paymob first
  if (lesson.paymentStatus !== LESSON_PAYMENT_STATUS.PAID) {
    return next(new ApiError("Payment not received yet", 400));
  }

  try {
    const result = await releasePaymentForLesson(lesson);

    if (result.alreadyReleased) {
      return res.status(200).json({
        message: result.message,
      });
    }

    res.status(200).json({
      message: "Payment released to teacher successfully",
      payoutId: result.payoutId,
      details: {
        totalAmount: result.totalAmount,
        teacherAmount: result.teacherAmount,
        platformFee: result.platformFee,
        gatewayFee: result.gatewayFee,
      },
    });
  } catch (err) {
    console.error("[Paymob][Payout] Error:", err.response?.data || err.message);
    return next(new ApiError("Failed to release payment to teacher", 500));
  }
});
