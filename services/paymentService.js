const axios = require("axios");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");

// ===============================
// 1️⃣ INITIATE PAYMENT
// ===============================
exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const lesson = await Lesson.findById(lessonId).populate("student");
  if (!lesson) throw new ApiError("Lesson not found", 404);


  // ✅ Verify ownership
  if (lesson.student._id.toString() !== req.user._id.toString()) {
    throw new ApiError("You are not allowed to pay for this lesson", 403);
  }

  // ✅ Check if already paid
  if (lesson.paymentStatus === "paid") {
    throw new ApiError("Lesson is already paid", 400);
  }

  if (lesson.paymentStatus === "released") {
    throw new ApiError("Payment has already been released to the teacher", 400);
  }

  if (lesson.status === "canceled"  ) {
    throw new ApiError("Cannot pay for a canceled lesson", 400);
  }

  // ✅ Prepare payment
  let paymentLink;
  try {
        const amount = lesson.price * 100;

        // 1️⃣ Get auth token
        const { data: auth } = await axios.post(`${process.env.PAYMOB_API_URL}/auth/tokens`, {
          api_key: process.env.PAYMOB_API_KEY,
        });

        // 2️⃣ Create order
        const { data: order } = await axios.post(`${process.env.PAYMOB_API_URL}/ecommerce/orders`, {
          auth_token: auth.token,
          amount_cents: amount,
          currency: "EGP",
          merchant_order_id: lesson._id.toString(),
        });

        // 3️⃣ Generate payment key
        const { data: paymentKey } = await axios.post(`${process.env.PAYMOB_API_URL}/acceptance/payment_keys`, {
          auth_token: auth.token,
          amount_cents: amount,
          expiration: 3600,
          order_id: order.id,
          billing_data: {
            apartment: "NA",
            email: lesson.student.email,
            floor: "NA",
            first_name: lesson.student.first_name || "Student",
            last_name: lesson.student.last_name || "User",
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
        });

        // 💾 Save payment data
        lesson.payment = {
          amount: amount / 100,
          paymobOrderId: order.id,
          status: "pending",
        };
        await lesson.save();

        paymentLink = `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentKey.token}`;


  }catch (err) {
    console.error("❌ Paymob payment initiation failed:", err.response?.data || err.message);
    return next(new ApiError("Failed to initiate payment", 500));
  }

  res.status(200).json({
    status: "success",
    paymentLink,
  });
});

// ===============================
// 2️⃣ HANDLE PAYMOB CALLBACK
// ===============================
exports.handlePaymentCallback = asyncHandler(async (req, res) => {
  try {
    const { obj, hmac } = req.body;

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
          value = value ? value[k] : "";
        });
        return value ? value.toString() : "";
      })
      .join("");

    const calculatedHmac = crypto
      .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
      .update(concatenatedString)
      .digest("hex");

    if (calculatedHmac !== hmac)
      return res.status(400).json({ message: "Invalid HMAC signature" });

    const lessonId = obj.order.merchant_order_id;

    if (obj.success) {
      await Lesson.findByIdAndUpdate(lessonId, {
        paymentStatus: "paid",
        status: "approved",
        "payment.status": "paid",
        "payment.transactionId": obj.id,
      });
    } else {
      await Lesson.findByIdAndUpdate(lessonId, {
        "payment.status": "failed",
      });
    }

    res.status(200).json({ message: "Callback processed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error processing callback" });
  }
});

// ===============================
// 3️⃣ RELEASE PAYMENT TO TEACHER
// ===============================
exports.releasePaymentToTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate("acceptedTeacher");
  if (!lesson) return next(new ApiError("Lesson not found", 404));
  if (lesson.status !== "completed")
    return next(new ApiError("Lesson must be completed before payout", 400));

  if (lesson.paymentStatus !== "paid")
    return next(new ApiError("Payment not received yet", 400));

  if (lesson.paymentStatus === "released")
    return next(new ApiError("Payment already released", 400));

  const teacher = lesson.acceptedTeacher;
  if (!teacher?.teacherProfile?.payoutRecipientId)
    return next(new ApiError("Teacher has no payout account", 400));

  try{
      const { data: payout } = await axios.post(
          "https://accept.paymob.com/api/acceptance/payout",
          {
            amount: lesson.price * 100,
            currency: "EGP",
            recipient: teacher.teacherProfile.payoutRecipientId,
            description: `Payout for lesson ${lesson._id}`,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYMOB_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        lesson.paymentStatus = "released";
        lesson.teacherPayoutId = payout.id;
        await lesson.save();

  }catch (err) {
    console.error("❌ Paymob payout failed:", err.response?.data || err.message);
    return next(new ApiError("Failed to release payment to teacher", 500));
  }
 
  res.status(200).json({
    message: "Payment released to teacher successfully",
    payoutId: payout.id,
  });
});
