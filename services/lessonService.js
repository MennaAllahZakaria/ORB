const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const Thread = require("../models/LessonNegotiationThreadModel");

const { decryptToken } = require("../utils/fcmToken");
const { addPoints, deductPoints } = require("./pointsService");

const admin = require("../fireBase/admin");
const sendEmail = require("../utils/sendEmail"); 
const ApiFeatures = require("../utils/apiFeatures");
const { sendLessonNotifications , sendInterestNotification , sendChooseTeacherNotification } = require("../utils/lessonNotificaionHelper");
const { createLessonMeeting } = require("./zegoService");


// Small helper to compare ObjectIds safely
const isSameId = (a, b) =>
  a && b && a.toString() === b.toString();



// =======================================================
// 1️⃣ STUDENT - CREATE LESSON REQUEST
// =======================================================
exports.createLessonRequest = asyncHandler(async (req, res, next) => {

  const { subject, requestedDate, durationInMinutes, price, title } = req.body;

  /* =========================
     VALIDATION
  ========================== */

  if (!subject || !requestedDate || !durationInMinutes || !price || !title) {
    return next(
      new ApiError(
        "title, subject, requestedDate, durationInMinutes and price are required",
        400
      )
    );
  }

  const lessonDate = new Date(requestedDate);

  if (lessonDate <= new Date()) {
    return next(new ApiError("requestedDate must be in the future", 400));
  }

  /* =========================
     CREATE LESSON
  ========================== */

  const lesson = await Lesson.create({
    student: req.user._id,
    title,
    subject,
    requestedDate: lessonDate,
    durationInMinutes,
    price,
    meetingStatus: "upcoming"
  });

  /* =========================
     FIND MATCHING TEACHERS (Optimized Query)
  ========================== */

  const minHourly =
    (price * 0.8 * 60) / durationInMinutes;

  const maxHourly =
    (price * 1.2 * 60) / durationInMinutes;

  let teachers = await User.find(
    {
      role: "teacher",
      "teacherProfile.subjects": subject,
      "teacherProfile.pricePerHour": {
        $gte: minHourly,
        $lte: maxHourly
      }
    },
    "firstName lastName email fcmToken preferredLang teacherProfile.pricePerHour"
  );

  // fallback لو مفيش حد في الرينج
  if (!teachers.length) {
    teachers = await User.find(
      {
        role: "teacher",
        "teacherProfile.subjects": subject
      },
      "firstName lastName email fcmToken preferredLang"
    );
  }

  /* =========================
     RESPONSE FIRST (NON BLOCKING)
  ========================== */

  res.status(201).json({
    status: "success",
    message: "Lesson created successfully",
    data: lesson
  });

  /* =========================
     SEND NOTIFICATIONS BACKGROUND
  ========================== */

  setImmediate(() => {
    sendLessonNotifications(lesson, teachers, req.user);
  });

});


// =======================================================
// 2️⃣ TEACHER - GET LESSON REQUESTS (Matching Subjects)
// =======================================================
exports.getLessonRequestsForTeacher = asyncHandler(async (req, res, next) => {

  if (req.user.role !== "teacher") {
    return next(
      new ApiError("Only teachers can access lesson requests", 403)
    );
  }

  /* =========================
     GET TEACHER SUBJECTS
  ========================== */

  const teacher = await User.findById(req.user._id)
    .select("teacherProfile.subjects");

  if (!teacher?.teacherProfile?.subjects?.length) {
    return next(
      new ApiError("Teacher has no subjects configured in profile", 400)
    );
  }

  /* =========================
     PAGINATION
  ========================== */

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  /* =========================
     QUERY
  ========================== */

  const filter = {
    subject: { $in: teacher.teacherProfile.subjects },
    status: "pending",
    interestedTeachers: { $ne: req.user._id }
  };

  const lessons = await Lesson.find(filter)
    .select("title subject price requestedDate durationInMinutes student createdAt")
    .populate("student", "firstName lastName studentProfile.grade")
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await Lesson.countDocuments(filter);

  res.status(200).json({
    status: "success",
    page,
    results: lessons.length,
    total,
    data: lessons
  });

});



// =======================================================
// 5️⃣ TEACHER - RESPOND TO LESSON REQUEST (INTEREST/REJECT)
// =======================================================
exports.respondToLessonRequest = asyncHandler(async (req, res, next) => {

  if (req.user.role !== "teacher") {
    return next(
      new ApiError("Only teachers can respond to lesson requests", 403)
    );
  }

  const { lessonId } = req.params;
  const { response } = req.body;
  const teacherId = req.user._id;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  /* =============================
     REJECT
  ============================== */
  if (response === "reject") {
    lesson.interestedTeachers = lesson.interestedTeachers.filter(
      (id) => !isSameId(id, teacherId)
    );

    await lesson.save();

    return res.status(200).json({
      message: "You rejected this request."
    });
  }

  /* =============================
     VALIDATION
  ============================== */
  if (lesson.status !== "pending") {
    return next(
      new ApiError("Cannot respond to this lesson at its current status", 400)
    );
  }

  /* =============================
     ADD INTEREST
  ============================== */
  const alreadyInterested = lesson.interestedTeachers.some((id) =>
    isSameId(id, teacherId)
  );

  if (!alreadyInterested) {
    lesson.interestedTeachers.push(teacherId);
    await lesson.save();
  }

  /* =============================
     RESPONSE FIRST
  ============================== */

  res.status(200).json({
    message: "Response saved successfully.",
    data: lesson,
  });

  /* =============================
     BACKGROUND NOTIFICATION
  ============================== */

  setImmediate(() => {
    sendInterestNotification(lesson, req.user);
  });
});
// =======================================================
// 6️⃣ STUDENT - UPDATE LESSON PRICE REQUEST
// =======================================================
exports.updateLessonPriceRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { newPrice } = req.body;

  if (!newPrice || newPrice <= 0) {
    return next(
      new ApiError("newPrice must be a positive number", 400)
    );
  }

  const lesson = await Lesson.findById(lessonId).select(
    "student status acceptedTeacher price"
  );

  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError("You are not authorized to modify this lesson", 403)
    );
  }

  if (lesson.status !== "pending" || lesson.acceptedTeacher) {
    return next(
      new ApiError(
        "Cannot update price for this lesson at its current status",
        400
      )
    );
  }

  lesson.price = newPrice;
  await lesson.save();

  res.status(200).json({
    message: "Lesson price updated successfully.",
    data: lesson,
  });
});

// =======================================================
// 7️⃣ STUDENT - CHOOSE TEACHER FOR LESSON
// =======================================================
exports.chooseTeacher = asyncHandler(async (req, res, next) => {

  const { lessonId, teacherId } = req.params;

  /* ======================================
     FIND LESSON WITH ATOMIC CONDITIONS
  ======================================= */

  const lesson = await Lesson.findOne({
    _id: lessonId,
    student: req.user._id,
    status: "pending",
    interestedTeachers: teacherId
  });

  if (!lesson)
    return next(new ApiError("Cannot choose this teacher", 400));

  /* ======================================
     CHECK IF THERE IS AN ACCEPTED THREAD
  ======================================= */

  const thread = await Thread.findOne({
    lesson: lessonId,
    teacher: teacherId,
    status: "accepted"
  });

  if (thread?.agreedPrice) {
    lesson.price = thread.agreedPrice;
  }

  /* ======================================
     APPROVE LESSON
  ======================================= */

  lesson.acceptedTeacher = teacherId;
  lesson.status = "approved";

  /* ======================================
     CREATE MEETING (ZEGO SERVICE)
  ======================================= */

  const {
    meetingRoomId,
    studentToken,
    teacherToken
  } = await createLessonMeeting({
    lesson,
    studentId: req.user._id,
    teacherId
  });

  /* ======================================
     CLOSE OTHER THREADS IF EXIST
  ======================================= */

  await Thread.updateMany(
    {
      lesson: lessonId,
      teacher: { $ne: teacherId },
      status: "negotiating"
    },
    { status: "closed" }
  );

  /* ======================================
     RESPONSE FIRST
  ======================================= */

  res.status(200).json({
    message: "Teacher selected successfully.",
    data: {
      lesson,
      meetingRoomId,
      tokens: {
        student: studentToken,
        teacher: teacherToken
      }
    }
  });

  /* ======================================
     BACKGROUND NOTIFICATION
  ======================================= */

  setImmediate(() => {
    sendChooseTeacherNotification(
      lesson._id,
      teacherId,
      req.user
    );
  });

});



// =======================================================
// 8️⃣ STUDENT - GET INTERESTED TEACHERS FOR LESSON
// =======================================================
exports.getInterestedTeachers = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate({
    path: "interestedTeachers",
    select:
      "firstName lastName email imageProfile teacherProfile.subjects teacherProfile.avgRating teacherProfile.bio teacherProfile.experienceYears",
  });

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError(
        "You are not authorized to view this lesson’s teachers",
        403
      )
    );
  }

  const teachers = lesson.interestedTeachers;

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers,
  });
});

// =======================================================
// 9️⃣ GET ALL LESSONS (Student/Teacher/Admin) + Filters
// =======================================================
exports.getLessons = asyncHandler(async (req, res, next) => {
  const user = req.user;
  let filter = {};

  if (user.role === "student") {
    filter = { student: user._id };
  } else if (user.role === "teacher") {
    // For teachers: lessons they're accepted in OR interested in
    filter = {
      $or: [{ acceptedTeacher: user._id }, { interestedTeachers: user._id }],
    };
  } else if (user.role === "admin") {
    filter = {};
  } else {
    return next(new ApiError("You are not authorized to view lessons", 403));
  }

  const lessonsCount = await Lesson.countDocuments(filter);

  const apiFeatures = new ApiFeatures(
    Lesson.find(filter)
      .populate("student", "firstName lastName email studentProfile")
      .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating")
      .populate("interestedTeachers", "firstName lastName email teacherProfile.avgRating"),
    req.query
  )
    .filter()
    .search("lessonModel")
    .sort()
    .limitFields()
    .paginate(lessonsCount);

  const { mongooseQuery, paginationResult } = apiFeatures;
  const lessons = await mongooseQuery;

  res.status(200).json({
    status: "success",
    results: lessons.length,
    pagination: paginationResult,
    data: lessons,
  });
});

// =======================================================
// 9️⃣ GET SINGLE LESSON DETAILS STUDENT ONLY (WITH POPULATED TEACHER INFO)
// =======================================================
exports.getLessonDetailsForStudent = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const lesson = await Lesson.findById(lessonId)
    .populate("student", "firstName lastName email studentProfile")
    .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating")
    .populate("interestedTeachers", "firstName lastName email teacherProfile.avgRating")
    .select("student acceptedTeacher interestedTeachers title subject price durationInMinutes requestedDate  meetingRoomId zegoTokenForStudent finalCompletionStatus");

  if (!lesson) return next(new ApiError("Lesson not found", 404));
  const isStudent = isSameId(lesson.student._id, req.user._id);
  if (!isStudent) {
    return next(
      new ApiError("You are not authorized to view this lesson", 403)
    );
  }

  res.status(200).json({
    status: "success",
    data: lesson,
  });
});

// =======================================================
// 9️⃣ GET SINGLE LESSON DETAILS TEACHER ONLY (WITH POPULATED STUDENT INFO)
// =======================================================
exports.getLessonDetailsForTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const lesson = await Lesson.findOne({
      _id: lessonId,
      $or: [
        { acceptedTeacher: req.user._id },
        { interestedTeachers: req.user._id }
      ]
    })
    .populate("student", "firstName lastName email studentProfile")
    .select("student  title subject price durationInMinutes requestedDate  meetingRoomId zegoTokenForTeacher finalCompletionStatus");


  if (!lesson) return next(new ApiError("Lesson not found", 404));

  

  res.status(200).json({
    status: "success",
    data: lesson,
  });
});

// =======================================================
// GET UPCOMING LESSONS FOR TEACHER/STUDENT
// =======================================================
exports.getUpcomingLessons = asyncHandler(async (req, res, next) => {

  const user = req.user;

  const page = Math.max(1, +req.query.page || 1);
  const limit = Math.min(50, +req.query.limit || 10);
  const skip = (page - 1) * limit;

  const { subject, paymentStatus, from, to, sort } = req.query;

  /* ===============================
     BASE FILTER
  =============================== */

  const filter = {
    status: "approved",
    requestedDate: { $gte: new Date() }
  };

  if (user.role === "student") {
    filter.student = user._id;
  } else if (user.role === "teacher") {
    filter.acceptedTeacher = user._id;
  } else {
    return next(new ApiError("Not authorized", 403));
  }

  /* ===============================
     OPTIONAL FILTERS
  =============================== */

  if (subject) {
    filter.subject = subject;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  if (from || to) {
    filter.requestedDate = {};
    if (from) filter.requestedDate.$gte = new Date(from);
    if (to) filter.requestedDate.$lte = new Date(to);
  }

  /* ===============================
     TOTAL COUNT
  =============================== */

  const total = await Lesson.countDocuments(filter);

  /* ===============================
     QUERY
  =============================== */

  const lessons = await Lesson.find(filter)
    .populate("student", "firstName lastName email studentProfile")
    .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating")
    .select("title subject price durationInMinutes requestedDate meetingRoomId finalCompletionStatus paymentStatus")
    .sort(sort || "requestedDate")
    .skip(skip)
    .limit(limit);

  /* ===============================
     RESPONSE
  =============================== */

  res.status(200).json({
    status: "success",
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
    results: lessons.length,
    data: lessons
  });

});



// =======================================================
// 1️⃣1️⃣ STUDENT - CANCEL LESSON REQUEST
// =======================================================
exports.cancelLessonRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError("You are not authorized to cancel this lesson", 403)
    );
  }

  // Block cancel if lesson already completed or canceled
  if (lesson.status === "completed" || lesson.status === "canceled") {
    return next(
      new ApiError("This lesson cannot be canceled at its current status", 400)
    );
  }

  // Optional: block cancel if already paid
  if (
    lesson.paymentStatus === "paid" ||
    lesson.paymentStatus === "released"
  ) {
    return next(
      new ApiError(
        "Cannot cancel a lesson that has already been paid. Please contact support.",
        400
      )
    );
  }

  lesson.status = "canceled";
  await lesson.save();

  // Deduct points for cancellation
  if (lesson.student) {
    await deductPoints(lesson.student, 15);
  }

  res.status(200).json({
    status: "success",
    message: "Lesson request canceled successfully.",
    data: lesson,
  });
});
