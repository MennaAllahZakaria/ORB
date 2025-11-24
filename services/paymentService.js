const axios = require("axios");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const { addPoints } = require("./pointsService");

// ===============================
// 🔧 CONSTANTS & BASIC VALIDATION
// ===============================

// Centralized payment status values to avoid string mistakes
const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  RELEASED: "released",
  FAILED: "failed",
};

// (Optional) Log missing env vars early – helps debugging config issues
const PAYMOB_REQUIRED_ENV_VARS = [
  "PAYMOB_API_URL",
  "PAYMOB_API_KEY",
  "PAYMOB_IFRAME_ID",
  "PAYMOB_INTEGRATION_ID",
  "PAYMOB_HMAC_SECRET",
];

PAYMOB_REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`[Paymob][Config] Missing env var: ${key}`);
  }
});

// ===============================
// 1️⃣ INITIATE PAYMENT
// ===============================
exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  // ✅ Fetch lesson with student populated (needed for billing data)
  const lesson = await Lesson.findById(lessonId).populate("student");
  if (!lesson) {
    throw new ApiError("Lesson not found", 404);
  }

  // ✅ Verify the logged-in user is the student of this lesson
  if (lesson.student._id.toString() !== req.user._id.toString()) {
    throw new ApiError("You are not allowed to pay for this lesson", 403);
  }

  // ✅ Disallow payment for canceled lessons
  if (lesson.status === "canceled") {
    throw new ApiError("Cannot pay for a canceled lesson", 400);
  }

  // ✅ Handle payment status logic more clearly
  if (lesson.paymentStatus === PAYMENT_STATUS.RELEASED) {
    // Money already sent to the teacher
    throw new ApiError("Payment has already been released to the teacher", 400);
  }

  if (
    lesson.paymentStatus === PAYMENT_STATUS.PAID ||
    lesson.paymentStatus === PAYMENT_STATUS.PENDING
  ) {
    // Either already paid or payment is in-progress
    throw new ApiError(
      "Lesson is already paid or a payment is currently in progress",
      400
    );
  }

  // ✅ Prepare amount in cents (use Math.round to avoid float precision issues)
  const amountCents = Math.round(lesson.price * 100);

  let paymentLink;

  try {
    // 1️⃣ Get Paymob auth token
    const { data: auth } = await axios.post(
      `${process.env.PAYMOB_API_URL}/auth/tokens`,
      {
        api_key: process.env.PAYMOB_API_KEY,
      }
    );

    // 2️⃣ Create Paymob order
    const { data: order } = await axios.post(
      `${process.env.PAYMOB_API_URL}/ecommerce/orders`,
      {
        auth_token: auth.token,
        amount_cents: amountCents,
        currency: "EGP",
        // Using lesson._id as merchant_order_id so we can get the lesson from callback
        merchant_order_id: lesson._id.toString(),
      }
    );

    // 3️⃣ Generate payment key
    const { data: paymentKey } = await axios.post(
      `${process.env.PAYMOB_API_URL}/acceptance/payment_keys`,
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
          phone_number: lesson.student.phone || "NA",
          city: "Cairo",
          country: "EG",
          street: "NA",
          building: "NA",
          shipping_method: "NA",
          postal_code: "NA",
          state: "NA",
        },
        currency: "EGP",
        integration_id: process.env.PAYMOB_INTEGRATION_ID,
      }
    );

    // 💾 Persist payment data (mark as pending)
    lesson.payment = {
      amount: amountCents / 100,
      paymobOrderId: order.id,
      status: PAYMENT_STATUS.PENDING,
    };
    lesson.paymentStatus = PAYMENT_STATUS.PENDING;
    await lesson.save();

    // Build the iframe payment link
    paymentLink = `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey.token}`;
  } catch (err) {
    console.error(
      "[Paymob][Initiate] Payment initiation failed:",
      err.response?.data || err.message
    );
    return next(new ApiError("Failed to initiate payment", 500));
  }

  res.status(200).json({
    status: "success",
    paymentLink,
  });
});

// ===============================
// 2️⃣ HANDLE PAYMOB CALLBACK (WEBHOOK)
// ===============================
exports.handlePaymentCallback = asyncHandler(async (req, res) => {
  try {
    const { obj, hmac } = req.body;

    if (!obj || !hmac) {
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    // ⚠️ Important:
    // The following keys and their order must match Paymob docs exactly
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
        // Support nested keys like "order.id"
        const keys = key.split(".");
        let value = obj;
        keys.forEach((k) => {
          value = value ? value[k] : undefined;
        });

        // ⚠️ DO NOT treat false/0 as empty string – they must be preserved.
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

    // ✅ Validate amount to prevent tampering
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

    const isSuccess = !!obj.success;

    if (isSuccess) {
      // Idempotency: if already processed as paid/released, just acknowledge
      if (
        lesson.paymentStatus === PAYMENT_STATUS.PAID ||
        lesson.paymentStatus === PAYMENT_STATUS.RELEASED
      ) {
        return res
          .status(200)
          .json({ message: "Payment already processed previously" });
      }

      // ✅ Mark payment as paid and approve lesson
      lesson.paymentStatus = PAYMENT_STATUS.PAID;
      lesson.status = "approved"; // business logic: you might adjust this
      lesson.payment = {
        ...lesson.payment,
        status: PAYMENT_STATUS.PAID,
        transactionId: obj.id,
      };

      await lesson.save();

      // ✅ Add booking points (await to catch errors if any)
      if (lesson?.student?._id) {
        try {
          await addPoints(
            lesson.student._id,
            10,
            "Lesson booked successfully"
          );
        } catch (pointsErr) {
          // Do NOT fail the payment because of a points error – just log it
          console.error(
            "[Points] Failed to add points after successful payment:",
            pointsErr.message
          );
        }
      }
    } else {
      // Payment failed
      lesson.paymentStatus = PAYMENT_STATUS.FAILED;
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
// ⚠️ IMPORTANT:
// Make sure the route using this controller is protected (e.g. admin/system only),
// so that normal users cannot trigger payouts manually.
exports.releasePaymentToTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate("acceptedTeacher");
  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  // Business rule: only completed lessons can be paid out
  if (lesson.status !== "completed") {
    return next(
      new ApiError("Lesson must be completed before payout", 400)
    );
  }

  // Payment already released
  if (lesson.paymentStatus === PAYMENT_STATUS.RELEASED) {
    return next(new ApiError("Payment already released", 400));
  }

  // Payment must be marked as paid (from Paymob callback) first
  if (lesson.paymentStatus !== PAYMENT_STATUS.PAID) {
    return next(new ApiError("Payment not received yet", 400));
  }

  const teacher = lesson.acceptedTeacher;
  if (!teacher) {
    return next(new ApiError("No accepted teacher found for this lesson", 400));
  }

  const payoutRecipientId = teacher?.teacherProfile?.paymentInfo?.payoutRecipientId;

  if (!payoutRecipientId) {
    return next(new ApiError("Teacher has no payout account", 400));
  }


  // 💰 Commission logic
  const platformFeePercentage = 0.20; // 20% platform
  const gatewayFeePercentage = 0.03; // 3% payment gateway
  const totalFeePercentage = platformFeePercentage + gatewayFeePercentage;

  const totalAmount = lesson.price; // full amount paid by student (EGP)
  const teacherAmount = totalAmount * (1 - totalFeePercentage);

  // Pre-calc fee breakdown for logging & storing
  const platformFeeAmount = totalAmount * platformFeePercentage;
  const gatewayFeeAmount = totalAmount * gatewayFeePercentage;

  try {
    // ⚠️ TODO:
    // Double-check this endpoint and authorization method against Paymob's latest payout docs.
    // Many Paymob APIs use an auth_token from /auth/tokens instead of Bearer API key.
    const { data: payout } = await axios.post(
      "https://accept.paymob.com/api/acceptance/payout",
      {
        amount: Math.round(teacherAmount * 100), // paymob expects cents
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
    lesson.paymentStatus = PAYMENT_STATUS.RELEASED;
    lesson.teacherPayoutId = payout.id;
    lesson.payment = {
      ...lesson.payment,
      amount: totalAmount,
      status: PAYMENT_STATUS.RELEASED,
    };
    lesson.amountPaid = teacherAmount; // Net amount teacher actually receives
    lesson.fees = {
      platform: platformFeeAmount,
      gateway: gatewayFeeAmount,
    };

    await lesson.save();

    console.log(
      `✅ Payment released to teacher: ${teacher._id} | Lesson: ${lesson._id} | Teacher Amount: ${teacherAmount} EGP`
    );

    res.status(200).json({
      message: "Payment released to teacher successfully",
      payoutId: payout.id,
      details: {
        totalAmount,
        teacherAmount,
        platformFee: platformFeeAmount,
        gatewayFee: gatewayFeeAmount,
      },
    });
  } catch (err) {
    console.error(
      "[Paymob][Payout] Payout failed:",
      err.response?.data || err.message
    );
    return next(new ApiError("Failed to release payment to teacher", 500));
  }
});
