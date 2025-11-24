const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const Review = require("../models/reviewModel");
const axios = require("axios");

// ===============================
// 🔐 UPDATE TEACHER PAYMENT INFO
// ===============================
exports.updatePaymentInfo = asyncHandler(async (req, res, next) => {
  const {
    method,
    accountName,
    accountNumber,
    bankName,
    walletProvider,
    phoneNumber,
  } = req.body;

  // ✅ Only teachers can set payment info
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can add payment info", 403));
  }

  if (!method) {
    return next(
      new ApiError("Payment method is required (bank or wallet)", 400)
    );
  }

  if (!["bank", "wallet"].includes(method)) {
    return next(new ApiError("Invalid payment method", 400));
  }

  const teacher = await User.findById(req.user._id);
  if (!teacher) return next(new ApiError("Teacher not found", 404));

  if (!teacher.teacherProfile) teacher.teacherProfile = {};
  if (!teacher.teacherProfile.paymentInfo)
    teacher.teacherProfile.paymentInfo = {};

  // 🔎 Extra validation based on method
  if (method === "bank") {
    if (!accountName || !accountNumber || !bankName) {
      return next(
        new ApiError(
          "For bank method, accountName, accountNumber and bankName are required",
          400
        )
      );
    }
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

  // ✅ Merge / update paymentInfo (do not erase existing payoutRecipientId)
  const oldInfo = teacher.teacherProfile.paymentInfo || {};

  teacher.teacherProfile.paymentInfo = {
    method,
    accountName: accountName || oldInfo.accountName,
    accountNumber: accountNumber || oldInfo.accountNumber,
    bankName: bankName || oldInfo.bankName,
    walletProvider: walletProvider || oldInfo.walletProvider,
    phoneNumber: phoneNumber || oldInfo.phoneNumber || teacher.phone,
    payoutRecipientId: oldInfo.payoutRecipientId || null,
  };

  // ✅ Register teacher with Paymob (create recipient only once)
  if (!teacher.teacherProfile.paymentInfo.payoutRecipientId) {
    try {
      // ⚠️ NOTE:
      // Check Paymob docs: some endpoints require auth_token from /auth/tokens
      // instead of Bearer API key. Adjust if needed.
      const paymobRes = await axios.post(
        "https://accept.paymob.com/api/acceptance/payouts/recipients",
        {
          name:
            accountName ||
            `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim(),
          email: teacher.email,
          phone:
            phoneNumber || teacher.teacherProfile.paymentInfo.phoneNumber || teacher.phone,
          type: method, // "bank" or "wallet"
          account_number: accountNumber || null,
          bank_name: bankName || null,
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
        throw new Error("Invalid Paymob response: missing recipient id");
      }
    } catch (err) {
      console.error(
        "[Paymob][Recipients] Registration failed:",
        err.response?.data || err.message
      );
      return next(
        new ApiError("Failed to register payout account with Paymob", 500)
      );
    }
  }

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
