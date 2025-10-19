const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const axios = require("axios");

// ✅ Teacher updates their payment info
exports.updatePaymentInfo = asyncHandler(async (req, res, next) => {
  const { method, accountName, accountNumber, bankName, walletProvider, phoneNumber } = req.body;

  // ===== Validation =====
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can add payment info", 403));
  }

  if (!method) {
    return next(new ApiError("Payment method is required (bank or wallet)", 400));
  }

  if (!["bank", "wallet"].includes(method)) {
    return next(new ApiError("Invalid payment method", 400));
  }

  const teacher = await User.findById(req.user._id);
  if (!teacher) return next(new ApiError("Teacher not found", 404));

  if (!teacher.teacherProfile) teacher.teacherProfile = {};
  if (!teacher.teacherProfile.paymentInfo) teacher.teacherProfile.paymentInfo = {};

  // ===== Assign Payment Info =====
  teacher.teacherProfile.paymentInfo = {
    method,
    accountName: accountName || teacher.teacherProfile.paymentInfo.accountName,
    accountNumber: accountNumber || teacher.teacherProfile.paymentInfo.accountNumber,
    bankName: bankName || teacher.teacherProfile.paymentInfo.bankName,
    walletProvider: walletProvider || teacher.teacherProfile.paymentInfo.walletProvider,
    phoneNumber: phoneNumber || teacher.teacherProfile.paymentInfo.phoneNumber,
    payoutRecipientId: teacher.teacherProfile.paymentInfo.payoutRecipientId, // keep old if exists
  };

  // ===== Register teacher with Paymob (if not registered yet) =====
  if (!teacher.teacherProfile.paymentInfo.payoutRecipientId) {
    try {
      const paymobRes = await axios.post(
        "https://accept.paymob.com/api/acceptance/payouts/recipients",
        {
          name: accountName || `${teacher.firstName} ${teacher.lastName}`,
          email: teacher.email,
          phone: phoneNumber,
          type: method,
          account_number: accountNumber,
          bank_name: bankName,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYMOB_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (paymobRes.data?.id) {
        teacher.teacherProfile.paymentInfo.payoutRecipientId = paymobRes.data.id;
      } else {
        throw new Error("Invalid Paymob response");
      }
    } catch (err) {
      console.error("❌ Paymob registration failed:", err.response?.data || err.message);
      return next(new ApiError("Failed to register payout account with Paymob", 500));
    }
  }

  await teacher.save();

  res.status(200).json({
    status: "success",
    message: "Payment info updated successfully",
    data: teacher.teacherProfile.paymentInfo,
  });
});

// ✅ Get teacher's payment info
exports.getPaymentInfo = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can view payment info", 403));
  }

  const teacher = await User.findById(req.user._id).select("teacherProfile.paymentInfo");

  if (!teacher) return next(new ApiError("Teacher not found", 404));

  const paymentInfo = teacher.teacherProfile?.paymentInfo;

  if (!paymentInfo || Object.keys(paymentInfo).length === 0) {
    return next(new ApiError("No payment info found for this teacher", 404));
  }

  res.status(200).json({
    status: "success",
    data: paymentInfo,
  });
});

// ===============================
//  GET TEACHER PAYOUT HISTORY
// ===============================
exports.getTeacherPayoutHistory = asyncHandler(async (req, res, next) => {
  const lessons = await Lesson.find({
    acceptedTeacher: req.user._id,
    paymentStatus: { $in: ["paid", "released"] },
  })
    .select("subject price paymentStatus teacherPayoutId createdAt updatedAt")
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: lessons.length,
    data: lessons,
  });
});
