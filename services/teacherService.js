const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const Review = require("../models/reviewModel");
const axios = require("axios");

// ===============================
// 🔐 UPDATE TEACHER PAYMENT INFO
// ===============================
const PAYMOB_PAYOUTS_BASE = process.env.PAYMOB_PAYOUTS_BASE || "https://payouts.paymobsolutions.com";
const PAYMOB_PAYOUTS_RECIPIENTS_PATH = process.env.PAYMOB_PAYOUTS_RECIPIENTS_PATH || "/recipients";
const PAYMOB_PAYOUTS_AUTH_PATH = process.env.PAYMOB_PAYOUTS_AUTH_PATH || "/auth/tokens";
const USE_AUTH_TOKEN = String(process.env.PAYMOB_PAYOUTS_USE_AUTH_TOKEN || "false").toLowerCase() === "true";
// If you have a dedicated payouts bearer token saved in env (optional)
const PAYMOB_PAYOUTS_BEARER = process.env.PAYMOB_PAYOUTS_BEARER || null;

// Helper to get an Authorization header value for payouts endpoints
async function getPayoutsAuthHeader() {
  // Priority: explicit PAYMOB_PAYOUTS_BEARER -> auth token flow -> fallback to PAYMOB_API_KEY
  if (PAYMOB_PAYOUTS_BEARER) {
    return `Bearer ${PAYMOB_PAYOUTS_BEARER}`;
  }

  if (USE_AUTH_TOKEN) {
    // Call payouts auth endpoint to get token
    try {
      const authUrl = `${PAYMOB_PAYOUTS_BASE}${PAYMOB_PAYOUTS_AUTH_PATH}`;
      const { data } = await axios.post(
        authUrl,
        { api_key: process.env.PAYMOB_API_KEY },
        { headers: { "Content-Type": "application/json" } }
      );

      // many Paymob auth endpoints return { token: "..." } or { auth: { token: "..." } }
      const token = data?.token || data?.auth?.token || data?.data?.token;
      if (!token) {
        console.error("[Paymob][Payouts] auth token response missing token:", data);
        throw new Error("Payouts auth response missing token");
      }
      return `Bearer ${token}`;
    } catch (err) {
      console.error("[Paymob][Payouts] Failed to obtain auth token:", err.response?.data || err.message);
      throw new Error("Failed to obtain payouts auth token");
    }
  }

  if (process.env.PAYMOB_API_KEY) {
    return `Bearer ${process.env.PAYMOB_API_KEY}`;
  }

  throw new Error("No available Paymob credential for payouts. Set PAYMOB_PAYOUTS_BEARER or PAYMOB_API_KEY or enable auth token flow.");
}

exports.updatePaymentInfo = asyncHandler(async (req, res, next) => {
  const {
    method,
    accountName,
    accountNumber,
    bankName,
    walletProvider,
    phoneNumber,
    nationalId,
  } = req.body;

  // Only teachers allowed
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can add payment info", 403));
  }

  if (!method) {
    return next(new ApiError("Payment method is required (bank or wallet)", 400));
  }

  if (!["bank", "wallet"].includes(method)) {
    return next(new ApiError("Invalid payment method; allowed: 'bank' or 'wallet'", 400));
  }

  const teacher = await User.findById(req.user._id);
  if (!teacher) return next(new ApiError("Teacher not found", 404));

  if (!teacher.teacherProfile) teacher.teacherProfile = {};
  if (!teacher.teacherProfile.paymentInfo) teacher.teacherProfile.paymentInfo = {};

  // Extra validations by method
  if (method === "bank") {
    // bank payouts generally require account number / bank name / full name and often national id
    if (!accountName || !accountNumber || !bankName) {
      return next(
        new ApiError(
          "For bank method, accountName, accountNumber and bankName are required",
          400
        )
      );
    }
    // nationalId may be required by payouts provider - include if provided (preferred)
    // If your Paymob account requires national_id, pass it too.
  }

  if (method === "wallet") {
    if (!walletProvider || !phoneNumber) {
      return next(
        new ApiError(
          "For wallet method, walletProvider and phoneNumber are required",
          400
        )
      );
    }
  }

  const oldInfo = teacher.teacherProfile.paymentInfo || {};

  // Merge new info but preserve existing payoutRecipientId if present
  teacher.teacherProfile.paymentInfo = {
    method,
    accountName: accountName || oldInfo.accountName || null,
    accountNumber: accountNumber || oldInfo.accountNumber || null,
    bankName: bankName || oldInfo.bankName || null,
    walletProvider: walletProvider || oldInfo.walletProvider || null,
    phoneNumber: phoneNumber || oldInfo.phoneNumber || teacher.phone || null,
    nationalId: nationalId || oldInfo.nationalId || null,
    payoutRecipientId: oldInfo.payoutRecipientId || null, // keep existing if present
  };

  // If payoutRecipientId already exists, we skip creating a new recipient.
  if (!teacher.teacherProfile.paymentInfo.payoutRecipientId) {
    // Build recipient payload depending on method. Align keys with the instant cashin / recipients doc you have.
    const payload = {};

    // Common fields
    payload.name = teacher.teacherProfile.paymentInfo.accountName || `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim();
    payload.email = teacher.email;
    payload.phone = teacher.teacherProfile.paymentInfo.phoneNumber || teacher.phone || "";
    // Some Paymob recipients require a national_id - include if present
    if (teacher.teacherProfile.paymentInfo.nationalId) {
      payload.national_id = teacher.teacherProfile.paymentInfo.nationalId;
    }

    if (method === "bank") {
      // depending on Paymob API this might be account_number / bank_code / bank_name / account_type etc.
      payload.type = "bank_card"; // keep this generic; you may change to 'bank_account' or 'bank' per Paymob docs
      payload.account_number = teacher.teacherProfile.paymentInfo.accountNumber;
      // paymob might expect a bank code (e.g. "CIB") or numeric code - adapt if needed
      if (teacher.teacherProfile.paymentInfo.bankName) payload.bank_name = teacher.teacherProfile.paymentInfo.bankName;
      // optional: bank_transaction_type
      payload.bank_transaction_type = "cash_transfer";
    } else if (method === "wallet") {
      payload.type = "wallet"; // adapt to 'vodafone' / 'orange' etc. per Paymob docs if required
      payload.wallet_provider = teacher.teacherProfile.paymentInfo.walletProvider;
      payload.msisdn = teacher.teacherProfile.paymentInfo.phoneNumber; // msisdn field may be required for wallets
    }

    // Use env-configured base and path for recipient creation
    const recipientUrl = `${PAYMOB_PAYOUTS_BASE}${PAYMOB_PAYOUTS_RECIPIENTS_PATH}`;

    try {
      const authHeader = await getPayoutsAuthHeader();

      const paymobRes = await axios.post(recipientUrl, payload, {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });

      // The response shape may vary: look for id | recipient_id | data.id
      const returnedId =
        paymobRes.data?.id ||
        paymobRes.data?.recipient_id ||
        paymobRes.data?.data?.id ||
        paymobRes.data?.data?.recipient_id;

      if (!returnedId) {
        console.error("[Paymob][Recipients] Unexpected response:", paymobRes.data);
        throw new Error("Invalid Paymob recipient response (missing id)");
      }

      teacher.teacherProfile.paymentInfo.payoutRecipientId = returnedId;
    } catch (err) {
      // Log full response body for debugging (don't expose sensitive details to client)
      console.error("[Paymob][Recipients] Registration failed:", err.response?.data || err.message);
      // Keep the payment info changes locally so admin can retry, but return error
      await teacher.save().catch((e) => console.error("[Save] failed while saving teacher after failed recipient:", e.message));
      return next(new ApiError("Failed to register payout account with Paymob. Check logs for details.", 500));
    }
  } // end create recipient

  await teacher.save();

  res.status(200).json({
    status: "success",
    message: "Payment info updated successfully",
    data: teacher.teacherProfile.paymentInfo,
  });
});

// ===============================
// 🔍 GET TEACHER PAYMENT INFO
// ===============================
exports.getPaymentInfo = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can view payment info", 403));
  }

  const teacher = await User.findById(req.user._id).select(
    "teacherProfile.paymentInfo"
  );

  if (!teacher) return next(new ApiError("Teacher not found", 404));

  const paymentInfo = teacher.teacherProfile?.paymentInfo;

  if (!paymentInfo || Object.keys(paymentInfo).length === 0) {
    // You can return 200 with null if you prefer
    return next(
      new ApiError("No payment info found for this teacher", 404)
    );
  }

  res.status(200).json({
    status: "success",
    data: paymentInfo,
  });
});

// ===============================
// 💸 GET TEACHER PAYOUT HISTORY
// ===============================
exports.getTeacherPayoutHistory = asyncHandler(async (req, res, next) => {
  // ✅ Only teachers can view their payout history
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can view payout history", 403));
  }

  // If you want only finalized payouts, use ["released"]
  const lessons = await Lesson.find({
    acceptedTeacher: req.user._id,
    paymentStatus: { $in: ["paid", "released"] },
  })
    .select(
      "subject price paymentStatus teacherPayoutId amountPaid fees createdAt updatedAt"
    )
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: lessons.length,
    data: lessons,
  });
});

// ===============================
// 📚 GET ALL TEACHERS (Search + Filter + Pagination)
// ===============================
exports.getAllTeachers = asyncHandler(async (req, res, next) => {
  const { search, subject, minRate, maxRate, sort, page, limit } = req.query;

  // ✅ Always filter by role = teacher
  const filter = { role: "teacher" };

  // 🔎 Search: by name or subject (case-insensitive)
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { "teacherProfile.subjects": { $regex: search, $options: "i" } },
    ];
  }

  // 🎯 Filter by subject
  if (subject) {
    filter["teacherProfile.subjects"] = { $regex: subject, $options: "i" };
  }

  // ⭐ Filter by rating range
  if (minRate || maxRate) {
    filter["teacherProfile.avgRating"] = {};
    if (minRate) filter["teacherProfile.avgRating"].$gte = Number(minRate);
    if (maxRate) filter["teacherProfile.avgRating"].$lte = Number(maxRate);
  }

  // 📄 Pagination
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.max(Number(limit) || 10, 1);
  const skip = (pageNumber - 1) * limitNumber;

  // 🔽 Sorting mapping
  let sortOption = {};

  switch (sort) {
    case "rate":
      // highest rating first
      sortOption["teacherProfile.avgRating"] = -1;
      break;
    case "reviews":
      sortOption["teacherProfile.totalReviews"] = -1;
      break;
    case "priceLow":
      sortOption["teacherProfile.pricePerHour"] = 1;
      break;
    case "priceHigh":
      sortOption["teacherProfile.pricePerHour"] = -1;
      break;
    default:
      sortOption.createdAt = -1; // newest teachers first
      break;
  }

  // 📥 Query DB
  const teachers = await User.find(filter)
    .sort(sortOption)
    .skip(skip)
    .limit(limitNumber);

  const total = await User.countDocuments(filter);

  res.status(200).json({
    status: "success",
    results: teachers.length,
    total,
    page: pageNumber,
    totalPages: Math.ceil(total / limitNumber),
    data: teachers,
  });
});

// ===============================
// 👤 GET SINGLE TEACHER + REVIEWS
// ===============================
exports.getTeacher = asyncHandler(async (req, res, next) => {
  const teacher = await User.findById(req.params.id);

  if (!teacher) {
    return next(new ApiError("Teacher not found", 404));
  }

  if (teacher.role !== "teacher") {
    return next(new ApiError("User is not a teacher", 400));
  }

  const reviews = await Review.find({ teacher: teacher._id });

  res.status(200).json({
    status: "success",
    data: teacher,
    reviews,
  });
});

// ===============================
// ⏰ HELPER: CHECK OVERLAPPING TIMES
// ===============================
function isOverlapping(times) {
  const groupedByDay = {};

  // Group all slots by day
  for (const slot of times) {
    if (!groupedByDay[slot.day]) groupedByDay[slot.day] = [];
    groupedByDay[slot.day].push(slot);
  }

  const parseTime = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  // Check each day separately
  for (const day in groupedByDay) {
    const slots = groupedByDay[day];

    // Sort by start time
    slots.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    // Detect overlap between consecutive slots
    for (let i = 0; i < slots.length - 1; i++) {
      const currentEnd = parseTime(slots[i].endTime);
      const nextStart = parseTime(slots[i + 1].startTime);

      if (currentEnd > nextStart) {
        return true; // overlapping detected
      }
    }
  }

  return false;
}

// ===============================
// ⏰ UPDATE TEACHER AVAILABLE TIMES
// ===============================
// NOTE: Make sure you add `availableTimes` to teacherProfileSchema in your User model:
// availableTimes: [{
//   day: { type: String, enum: [...days] },
//   startTime: String, // "HH:MM"
//   endTime: String
// }]
// 
// exports.updateAvailableTimes = asyncHandler(async (req, res, next) => {
//   const teacherId = req.user._id;
//   const { availableTimes } = req.body;

//   if (req.user.role !== "teacher") {
//     return next(new ApiError("Only teachers can update available times", 403));
//   }

//   if (!availableTimes || !Array.isArray(availableTimes)) {
//     return next(new ApiError("availableTimes must be an array", 400));
//   }

//   const validDays = [
//     "Monday",
//     "Tuesday",
//     "Wednesday",
//     "Thursday",
//     "Friday",
//     "Saturday",
//     "Sunday",
//   ];

//   for (const slot of availableTimes) {
//     if (!validDays.includes(slot.day)) {
//       return next(new ApiError(`Invalid day: ${slot.day}`, 400));
//     }
//     if (!slot.startTime || !slot.endTime) {
//       return next(
//         new ApiError(
//           "Each time slot must include startTime and endTime",
//           400
//         )
//       );
//     }

//     const [startH, startM] = slot.startTime.split(":").map(Number);
//     const [endH, endM] = slot.endTime.split(":").map(Number);
//     if (startH * 60 + startM >= endH * 60 + endM) {
//       return next(
//         new ApiError(
//           `Invalid time range on ${slot.day}: startTime must be before endTime`,
//           400
//         )
//       );
//     }
//   }

//   if (isOverlapping(availableTimes)) {
//     return next(
//       new ApiError(
//         "Overlapping time ranges detected — please fix the schedule.",
//         400
//       )
//     );
//   }

//   const teacher = await User.findById(teacherId);
//   if (!teacher || teacher.role !== "teacher") {
//     return next(new ApiError("Teacher not found or not authorized", 403));
//   }

//   if (!teacher.teacherProfile) teacher.teacherProfile = {};
//   teacher.teacherProfile.availableTimes = availableTimes;
//   await teacher.save();

//   res.status(200).json({
//     status: "success",
//     message: "Available times updated successfully",
//     data: teacher.teacherProfile.availableTimes,
//   });
// });
