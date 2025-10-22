const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const Review = require("../models/reviewModel");
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



// ===============================
// 📚 GET ALL TEACHERS (Search + Filter + Pagination)
// ===============================
exports.getAllTeachers = asyncHandler(async (req, res) => {
  const { search, subject, minRate, maxRate, sort, page, limit } = req.query;

  // 1️⃣ Build filter object
  let filter = {};

  // Search by name or subject (case-insensitive)
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
    ];
  }

  // Filter by subject
  if (subject) filter.subject = { $regex: subject, $options: "i" };

  // Filter by rate range
  if (minRate || maxRate) {
    filter.rate = {};
    if (minRate) filter.rate.$gte = Number(minRate);
    if (maxRate) filter.rate.$lte = Number(maxRate);
  }

  // 2️⃣ Pagination
  const pageNumber = Number(page) || 1;
  const limitNumber = Number(limit) || 10;
  const skip = (pageNumber - 1) * limitNumber;

  // 3️⃣ Sorting
  let sortOption = {};
  if (sort === "rate") sortOption.rate = -1;
  else if (sort === "reviews") sortOption.numberOfReviews = -1;
  else if (sort === "priceLow") sortOption.price = 1;
  else if (sort === "priceHigh") sortOption.price = -1;
  else sortOption.createdAt = -1; // default sort by newest

  // 4️⃣ Query the database
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
// 📚 GET SINGLE TEACHER
// ===============================

exports.getTeacher = asyncHandler(async (req, res, next) => {
  const teacher = await User.findById(req.params.id)

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
    reviews: reviews,
  });
});



// ✅ Helper function to check overlapping time ranges
function isOverlapping(times) {
  const groupedByDay = {};

  // 🔹 نجمع كل الأوقات حسب اليوم
  for (const slot of times) {
    if (!groupedByDay[slot.day]) groupedByDay[slot.day] = [];
    groupedByDay[slot.day].push(slot);
  }

  // 🔹 نفحص كل يوم لوحده
  for (const day in groupedByDay) {
    const slots = groupedByDay[day];

    // نحول الوقت إلى دقائق علشان المقارنة تكون دقيقة
    const parseTime = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };

    // نرتب الأوقات حسب بداية الوقت
    slots.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    // نتحقق إن مفيش أي وقت متداخل مع اللي بعده
    for (let i = 0; i < slots.length - 1; i++) {
      const currentEnd = parseTime(slots[i].endTime);
      const nextStart = parseTime(slots[i + 1].startTime);

      if (currentEnd > nextStart) {
        return true; // يوجد تداخل
      }
    }
  }

  return false;
}

// ✅ Update available times for logged-in teacher
// exports.updateAvailableTimes = asyncHandler(async (req, res, next) => {
//   const teacherId = req.user._id;
//   const { availableTimes } = req.body;

//   if (!availableTimes || !Array.isArray(availableTimes)) {
//     return next(new ApiError("availableTimes must be an array", 400));
//   }

//   const validDays = [
//     "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
//   ];

//   for (const slot of availableTimes) {
//     if (!validDays.includes(slot.day)) {
//       return next(new ApiError(`Invalid day: ${slot.day}`, 400));
//     }
//     if (!slot.startTime || !slot.endTime) {
//       return next(new ApiError("Each time slot must include startTime and endTime", 400));
//     }

//     // ✅ تأكد إن وقت البداية قبل وقت النهاية
//     const [startH, startM] = slot.startTime.split(":").map(Number);
//     const [endH, endM] = slot.endTime.split(":").map(Number);
//     if (startH * 60 + startM >= endH * 60 + endM) {
//       return next(new ApiError(`Invalid time range on ${slot.day}: startTime must be before endTime`, 400));
//     }
//   }

//   // ✅ التحقق من عدم وجود تداخل
//   if (isOverlapping(availableTimes)) {
//     return next(new ApiError("Overlapping time ranges detected — please fix the schedule.", 400));
//   }

//   const teacher = await User.findById(teacherId);
//   if (!teacher || teacher.role !== "teacher") {
//     return next(new ApiError("Teacher not found or not authorized", 403));
//   }

//   teacher.teacherProfile.availableTimes = availableTimes;
//   await teacher.save();

//   res.status(200).json({
//     status: "success",
//     message: "Available times updated successfully",
//     data: teacher.teacherProfile.availableTimes,
//   });
// });
