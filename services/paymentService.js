const axios = require("axios");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const { v4: uuidv4 } = require("uuid");

const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const { addPoints } = require("./pointsService");

/* =====================================================
   CONSTANTS
===================================================== */

const LESSON_PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PENDING: "pending",
  PAID: "paid",
  RELEASED: "released",
  REFUNDED: "refunded",
};

const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  RELEASED: "released",
  REFUNDED: "refunded",
};

const PAYMOB_ACCEPT_BASE = process.env.PAYMOB_API_URL; // https://accept.paymob.com/api
const PAYMOB_PAYOUTS_BASE = process.env.PAYMOB_PAYOUTS_BASE; // payouts env

/* =====================================================
   BANK NAME → BANK CODE MAP (Paymob)
===================================================== */

const BANK_CODE_MAP = {
  "National Bank of Egypt": "NBE",
  "Banque Misr": "MISR",
  "Commercial International Bank": "CIB",
  "Qatar National Bank": "QNB",
  "Alex Bank": "BOA",
  "HSBC": "HSBC",
  "Arab African International Bank": "AAIB",
  "Faisal Islamic Bank": "FAIB",
  "Abu Dhabi Islamic Bank": "ADIB",
};

function resolveBankCode(bankName) {
  return BANK_CODE_MAP[bankName] || bankName; // fallback لو مخزنة كـ CIB
}

/* =====================================================
   PAYMOB TOKEN HELPERS
===================================================== */

// Accept (card / wallet)
async function getPaymobAcceptToken() {
  const { data } = await axios.post(`${PAYMOB_ACCEPT_BASE}/auth/tokens`, {
    api_key: process.env.PAYMOB_API_KEY,
  });
  return data.token;
}

// Payouts / Instant Cashin
async function getPaymobPayoutsToken() {
  const { data } = await axios.post(`${PAYMOB_PAYOUTS_BASE}/auth/tokens`, {
    api_key: process.env.PAYMOB_PAYOUTS_API_KEY,
  });
  return data.token;
}

/* =====================================================
   INTERNAL BUSINESS HELPER
===================================================== */

async function releasePaymentForLesson(lesson) {
  if (!lesson.acceptedTeacher) {
    lesson = await Lesson.findById(lesson._id).populate("acceptedTeacher");
  }

  if (!lesson.acceptedTeacher) {
    throw new Error("No accepted teacher");
  }

  // 🔒 Idempotency
  if (lesson.paymentStatus === LESSON_PAYMENT_STATUS.RELEASED) {
    return { alreadyReleased: true };
  }

  if (lesson.paymentStatus !== LESSON_PAYMENT_STATUS.PAID) {
    throw new Error("Payment not in PAID state");
  }

  const teacher = lesson.acceptedTeacher;
  const paymentInfo = teacher.teacherProfile?.paymentInfo;

  if (!paymentInfo || !paymentInfo.method) {
    throw new Error("Teacher payment info missing");
  }

  /* =====================
     FEES
  ===================== */
  const PLATFORM_FEE = 0.2;
  const GATEWAY_FEE = 0.03;

  const totalAmount = lesson.price;
  const teacherAmount = Number(
    (totalAmount * (1 - PLATFORM_FEE - GATEWAY_FEE)).toFixed(2)
  );

  /* =====================
     client_reference (UUID)
  ===================== */
  const clientReference =
    lesson.payment?.clientReference || uuidv4();

  /* =====================
     PAYMOB DISBURSE PAYLOAD
  ===================== */
  const payload = {
    amount: teacherAmount,
    national_id: teacher.nationalId || "00000000000000",
    customer_bears_fees: false,
    client_reference: clientReference,
  };

  if (paymentInfo.method === "wallet") {
    payload.issuer = paymentInfo.walletProvider.toLowerCase();
    payload.msisdn = paymentInfo.phoneNumber;
  }

  if (paymentInfo.method === "bank") {
    payload.issuer = "bank_card";
    payload.full_name = paymentInfo.accountName;
    payload.bank_card_number = paymentInfo.accountNumber;
    payload.bank_transaction_type = "cash_transfer";
    payload.bank_code = resolveBankCode(paymentInfo.bankName);
  }

  /* =====================
     CALL PAYMOB (PAYOUTS)
  ===================== */
  const payoutsToken = await getPaymobPayoutsToken();

  const { data } = await axios.post(
    `${PAYMOB_PAYOUTS_BASE}/disburse/`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${payoutsToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  /* =====================
     SAVE RESULT
  ===================== */
  lesson.paymentStatus = LESSON_PAYMENT_STATUS.RELEASED;
  lesson.amountPaid = teacherAmount;

  lesson.payment = {
    ...lesson.payment,
    status: PAYMENT_STATUS.RELEASED,
    disburseTransactionId: data.transaction_id || null,
    disbursementStatus: data.disbursement_status || null,
    disbursementCode: data.status_code || null,
    disbursementDescription: data.status_description || null,
    clientReference,
  };

  await lesson.save();

  return {
    transactionId: data.transaction_id,
    teacherAmount,
  };
}

exports._releasePaymentForLesson = releasePaymentForLesson;

/* =====================================================
   1️⃣ INITIATE PAYMENT (STUDENT)
===================================================== */

exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { paymentMethod = "card", walletPhone, walletProvider } = req.body;

  const lesson = await Lesson.findById(lessonId).populate("student");
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (lesson.student._id.toString() !== req.user._id.toString()) {
    return next(new ApiError("Not allowed", 403));
  }

  if (lesson.paymentStatus !== LESSON_PAYMENT_STATUS.UNPAID) {
    return next(new ApiError("Lesson already paid", 400));
  }

  if (!["card", "wallet"].includes(paymentMethod)) {
    return next(new ApiError("Invalid payment method", 400));
  }

  if (paymentMethod === "wallet" && !walletPhone) {
    return next(new ApiError("walletPhone required", 400));
  }

  const amountCents = Math.round(lesson.price * 100);

  try {
    const token = await getPaymobAcceptToken();

    const { data: order } = await axios.post(
      `${PAYMOB_ACCEPT_BASE}/ecommerce/orders`,
      {
        auth_token: token,
        amount_cents: amountCents,
        currency: "EGP",
        merchant_order_id: lesson._id.toString(),
      }
    );

    const integrationId =
      paymentMethod === "wallet"
        ? process.env.PAYMOB_WALLET_INTEGRATION_ID
        : process.env.PAYMOB_CARD_INTEGRATION_ID;

    const { data: paymentKey } = await axios.post(
      `${PAYMOB_ACCEPT_BASE}/acceptance/payment_keys`,
      {
        auth_token: token,
        amount_cents: amountCents,
        order_id: order.id,
        currency: "EGP",
        integration_id: integrationId,
        billing_data: {
          email: lesson.student.email,
          first_name: lesson.student.firstName,
          last_name: lesson.student.lastName,
          phone_number: walletPhone || lesson.student.phone || "NA",
          city: "Cairo",
          country: "EG",
          street: "NA",
          building: "NA",
          floor: "NA",
          apartment: "NA",
          postal_code: "NA",
          state: "NA",
        },
      }
    );

    lesson.paymentStatus = LESSON_PAYMENT_STATUS.PENDING;
    lesson.payment = {
      amount: lesson.price,
      status: PAYMENT_STATUS.PENDING,
      paymobOrderId: order.id,
      method: paymentMethod,
    };

    await lesson.save();

    if (paymentMethod === "card") {
      return res.status(200).json({
        paymentLink: `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey.token}`,
      });
    }

    const { data: walletRes } = await axios.post(
      `${PAYMOB_ACCEPT_BASE}/acceptance/payments/pay`,
      {
        source: {
          identifier: walletPhone,
          subtype: walletProvider || "WALLET",
        },
        payment_token: paymentKey.token,
      }
    );

    res.status(200).json({
      redirectUrl: walletRes.redirect_url,
    });
  } catch (err) {
    console.error("[Paymob][Initiate]", err.response?.data || err.message);
    return next(new ApiError("Payment initiation failed", 500));
  }
});

/* =====================================================
   2️⃣ PAYMOB CALLBACK
===================================================== */

exports.handlePaymentCallback = asyncHandler(async (req, res) => {
  const { obj, hmac } = req.body;
  if (!obj || !hmac) return res.sendStatus(400);

  const keys = [
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_parent_transaction",
    "id",
    "integration_id",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order.id",
    "pending",
    "source_data.pan",
    "source_data.sub_type",
    "source_data.type",
    "success",
  ];

  const concatenated = keys
    .map((k) =>
      k.split(".").reduce((o, i) => (o ? o[i] : ""), obj) ?? ""
    )
    .join("");

  const calculated = crypto
    .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest("hex");

  if (calculated !== hmac) return res.sendStatus(400);

  const lesson = await Lesson.findById(obj.order.merchant_order_id);
  if (!lesson) return res.sendStatus(404);

  if (obj.success) {
    if (lesson.paymentStatus !== LESSON_PAYMENT_STATUS.PAID) {
      lesson.paymentStatus = LESSON_PAYMENT_STATUS.PAID;
      lesson.payment.status = PAYMENT_STATUS.PAID;
      lesson.payment.transactionId = obj.id;
      await lesson.save();

      try {
        await addPoints(lesson.student, 10, "Lesson payment");
      } catch (_) {}
    }
  } else {
    lesson.paymentStatus = LESSON_PAYMENT_STATUS.UNPAID;
    lesson.payment.status = PAYMENT_STATUS.FAILED;
    await lesson.save();
  }

  res.sendStatus(200);
});

/* =====================================================
   3️⃣ RELEASE PAYMENT (ADMIN / SYSTEM)
===================================================== */

exports.releasePaymentToTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate("acceptedTeacher");
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (lesson.status !== "completed") {
    return next(new ApiError("Lesson not completed", 400));
  }

  try {
    const result = await releasePaymentForLesson(lesson);

    if (result.alreadyReleased) {
      return res.status(200).json({ message: "Already released" });
    }

    res.status(200).json({
      message: "Payment released successfully",
      transactionId: result.transactionId,
      teacherAmount: result.teacherAmount,
    });
  } catch (err) {
    console.error("[Paymob][Release]", err.message);
    return next(new ApiError("Failed to release payment", 500));
  }
});
