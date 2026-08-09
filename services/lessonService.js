const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const mongoose = require("mongoose");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const Thread = require("../models/LessonNegotiationThreadModel");

const { decryptToken } = require("../utils/fcmToken");
const { addPoints, deductPoints } = require("./pointsService");

const admin = require("../fireBase/admin");
const sendEmail = require("../utils/sendEmail"); 
const ApiFeatures = require("../utils/apiFeatures");
const { sendLessonNotifications , sendInterestNotification , sendChooseTeacherNotification , cancelLessonNotification } = require("../utils/lessonNotificaionHelper");
const {checkTeacherAvailability} = require("../utils/helpers");
const { createLessonMeeting } = require("./zegoService");
const { handleRefund } = require("./payment/paymentHandleService");

const { getIO } = require("../config/socket");

// Small helper to compare ObjectIds safely
const isSameId = (a, b) =>
  a && b && a.toString() === b.toString();



// =======================================================
// 1️⃣ STUDENT - CREATE LESSON REQUEST
// =======================================================
exports.createLessonRequest = asyncHandler(async (req, res, next) => {
  const io = getIO();

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
  const now = new Date();

  // Auto-detect if lesson is urgent: 
  // If the requested time is within the next 30 minutes OR was in the last 15 minutes
  const diffInMinutes = (lessonDate - now) / (1000 * 60);
  const isUrgentAuto = diffInMinutes <= 30 && diffInMinutes >= -15;

  // If not urgent and time is in the past, reject it.
  if (!isUrgentAuto && lessonDate <= now) {
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
    isUrgent: isUrgentAuto,
    meetingStatus: "upcoming"
  });

  // broadcast للمدرسين حسب subject
  if (io) {
  
  io.to(`subject_${lesson.subject}`).emit("newLessonRequest", {
    _id: lesson._id,
    title: lesson.title,
    subject: lesson.subject,
    price: lesson.price,
    requestedDate: lesson.requestedDate
  });
  }
  /* =========================
     FIND MATCHING TEACHERS (Optimized Query)
  ========================== */

  // Get all teachers for this subject
  const teachers = await User.find(
    {
      role: "teacher",
      "teacherProfile.subjects": subject
    },
    "firstName lastName email fcmToken preferredLang teacherProfile.pricePerHour imageProfile"
  );

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

  const teacher = await User.findById(req.user._id)
    .select("teacherProfile.subjects teacherProfile.pricePerHour")
    .lean();

  if (!teacher?.teacherProfile?.subjects?.length) {
    return next(
      new ApiError("Teacher has no subjects configured in profile", 400)
    );
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const skip = (page - 1) * limit;

  const now = new Date();

  const sixHoursAgo = new Date(
    now.getTime() - 6 * 60 * 60 * 1000
  );

  const filter = {
    subject: { $in: teacher.teacherProfile.subjects },

    status: "pending",

    $or: [
      // Scheduled lessons
      {
        isUrgent: false,
        requestedDate: { $gte: now }
      },

      // Immediate lessons
      {
        isUrgent: true,
        requestedDate: {
          $gte: sixHoursAgo,
          $lte: now
        }
      }
    ],

    "interestedTeachers.teacher": {
      $ne: req.user._id
    },

    rejectedByTeachers: {
      $ne: req.user._id
    }
  };

  const teacherPricePerHour = teacher.teacherProfile.pricePerHour || 0;

  const [lessons, total] = await Promise.all([
    Lesson.aggregate([
      { $match: filter },

      {
        $addFields: {
          interestedTeachersCount: { $size: "$interestedTeachers" },
          // Calculate lesson hourly rate to compare with teacher's price
          lessonHourlyRate: {
            $divide: [
              { $multiply: ["$price", 60] },
              "$durationInMinutes"
            ]
          }
        }
      },
      {
        $addFields: {
          // Absolute difference between teacher price and lesson hourly rate
          priceDiff: { $abs: { $subtract: ["$lessonHourlyRate", teacherPricePerHour] } }
        }
      },

      {
        $lookup: {
          from: "users",
          localField: "student",
          foreignField: "_id",
          as: "student"
        }
      },

      { $unwind: "$student" },

      {
        $project: {
          title: 1,
          subject: 1,
          price: 1,
          requestedDate: 1,
          durationInMinutes: 1,
          createdAt: 1,
          interestedTeachersCount: 1,
          priceDiff: 1,

          "student.firstName": 1,
          "student.lastName": 1,
          "student.studentProfile": 1,
          "student.imageProfile": 1
        }
      },

      // Sort by price difference first (closest first), then by newest
      { $sort: { priceDiff: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    ]),

    Lesson.countDocuments(filter)
  ]);

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
// 5️⃣ TEACHER - RESPOND TO LESSON REQUEST (INTEREST/REJECT)
// =======================================================
exports.respondToLessonRequest = asyncHandler(async (req, res, next) => {

  if (req.user.role !== "teacher") {
    return next(
      new ApiError("Only teachers can respond to lesson requests", 403)
    );
  }

  const { lessonId } = req.params;
  const { response, proposedPrice } = req.body;

  const teacherId = req.user._id;

  /* =============================
     VALIDATE PRICE
  ============================== */

  if (
    proposedPrice !== undefined &&
    proposedPrice !== null &&
    proposedPrice <= 0
  ) {
    return next(new ApiError("Invalid proposed price", 400));
  }

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  const io = getIO();

  /* =============================
     REJECT
     Permanently hide lesson
  ============================== */

  if (response === "reject") {

    lesson.interestedTeachers =
      lesson.interestedTeachers.filter(
        (item) => !isSameId(item.teacher, teacherId)
      );

    /*
      Reject is different from cancel negotiation.

      Reject = teacher does not want this lesson,
      so add him to rejectedByTeachers.
    */

    if (
      !lesson.rejectedByTeachers.some(
        (id) => isSameId(id, teacherId)
      )
    ) {
      lesson.rejectedByTeachers.push(teacherId);
    }

    await lesson.save();

    if (io) {

      io.to(`subject_${lesson.subject}`).emit(
        "lessonRemoved",
        {
          lessonId: lesson._id,
          teacherId
        }
      );

    }

    return res.status(200).json({
      status: "success",
      message: "You rejected this request."
    });
  }

  /* =============================
     VALIDATION
  ============================== */

  if (lesson.status !== "pending") {
    return next(
      new ApiError(
        "Cannot respond to this lesson at its current status",
        400
      )
    );
  }

  /* =============================
     CHECK LESSON TIME
  ============================== */

  const now = new Date();

  if (lesson.isUrgent) {

    const gracePeriod = 6 * 60 * 60 * 1000;

    if (
      new Date(lesson.requestedDate).getTime() +
        gracePeriod <=
      now.getTime()
    ) {
      return next(
        new ApiError(
          "This urgent lesson request has expired.",
          400
        )
      );
    }

  } else {

    if (
      new Date(lesson.requestedDate).getTime() < now.getTime()
    ) {
      return next(
        new ApiError(
          "Cannot respond to a lesson whose scheduled time has passed.",
          400
        )
      );
    }

  }

  /* =============================
     CHECK TEACHER AVAILABILITY
  ============================== */

  await checkTeacherAvailability(
    teacherId,
    lesson.requestedDate,
    lesson.durationInMinutes
  );

  /* =============================
     ADD / UPDATE INTEREST
  ============================== */

  const finalPrice =
    proposedPrice || lesson.price;

  const existing =
    lesson.interestedTeachers.find(
      (item) => isSameId(item.teacher, teacherId)
    );

  if (existing) {

    existing.proposedPrice = finalPrice;

  } else {

    lesson.interestedTeachers.push({
      teacher: teacherId,
      proposedPrice: finalPrice
    });

  }


  await lesson.save();

  /* =============================
     REALTIME EVENTS
  ============================== */

  if (io) {

    io.to(`user_${lesson.student}`).emit(
      "teacherInterested",
      {
        lessonId: lesson._id,
        teacherId,
        proposedPrice: finalPrice
      }
    );

    io.to(`lesson_${lesson._id}`).emit(
      "interestedTeachersUpdated",
      {
        lessonId: lesson._id,
        teacherId,
        proposedPrice: finalPrice
      }
    );

  }

  /* =============================
     RESPONSE
  ============================== */

  res.status(200).json({
    status: "success",
    message: "Response saved successfully.",
    data: lesson
  });

  /* =============================
     BACKGROUND NOTIFICATION
  ============================== */

  setImmediate(() => {
    sendInterestNotification(
      lesson,
      req.user,
      finalPrice
    );
  });

});
// =======================================================
// 6️⃣ STUDENT - UPDATE LESSON PRICE REQUEST
// =======================================================

exports.updateLessonRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const {
    newPrice,
    newTitle,
    newDate
  } = req.body;

  /* =====================================
     VALIDATE PRICE
  ===================================== */

  if (
    newPrice === undefined ||
    newPrice === null ||
    Number(newPrice) <= 0
  ) {
    return next(
      new ApiError(
        "newPrice must be a positive number",
        400
      )
    );
  }

  /* =====================================
     GET LESSON
  ===================================== */

  const lesson = await Lesson.findById(lessonId).select(
    [
      "student",
      "status",
      "acceptedTeacher",
      "price",
      "paymentStatus",
      "interestedTeachers",
      "title",
      "requestedDate",
      "isUrgent"
    ].join(" ")
  );

  if (!lesson) {
    return next(
      new ApiError("Lesson not found", 404)
    );
  }

  /* =====================================
     AUTHORIZATION
  ===================================== */

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError(
        "You are not authorized to modify this lesson",
        403
      )
    );
  }

  /* =====================================
     LESSON STATUS
  ===================================== */

  if (
    lesson.status !== "pending" ||
    lesson.acceptedTeacher
  ) {
    return next(
      new ApiError(
        "Cannot update this lesson at its current status",
        400
      )
    );
  }

  /* =====================================
     PREVENT UPDATE DURING NEGOTIATION
  ===================================== */

  if (
    Array.isArray(lesson.interestedTeachers) &&
    lesson.interestedTeachers.length > 0
  ) {
    return next(
      new ApiError(
        "Cannot update lesson while negotiation is active",
        400
      )
    );
  }

  /* =====================================
     PREVENT UPDATE AFTER PAYMENT
  ===================================== */

  if (lesson.paymentStatus === "paid") {
    return next(
      new ApiError(
        "Cannot update a paid lesson",
        400
      )
    );
  }

  if (lesson.paymentStatus === "released") {
    return next(
      new ApiError(
        "Cannot update a lesson after payment has been released",
        400
      )
    );
  }

  /* =====================================
     VALIDATE DATE
  ===================================== */

  if (newDate !== undefined && newDate !== null) {

    const parsedDate = new Date(newDate);

    if (Number.isNaN(parsedDate.getTime())) {
      return next(
        new ApiError(
          "Invalid lesson date",
          400
        )
      );
    }

    /*
      Lesson date must be in the future.
      This applies to normal scheduled lessons.
    */

    if (
      !lesson.isUrgent &&
      parsedDate.getTime() <= Date.now()
    ) {
      return next(
        new ApiError(
          "Scheduled lesson date must be in the future",
          400
        )
      );
    }

    lesson.requestedDate = parsedDate;
  }

  /* =====================================
     UPDATE PRICE
  ===================================== */

  lesson.price = Number(newPrice);

  /* =====================================
     UPDATE TITLE
  ===================================== */

  if (
    newTitle !== undefined &&
    newTitle !== null &&
    String(newTitle).trim() !== ""
  ) {
    lesson.title = String(newTitle).trim();
  }


  /* =====================================
     SAVE
  ===================================== */

  await lesson.save();

  /* =====================================
     REALTIME
  ===================================== */

  const io = getIO();

  if (io) {

    io.to(`lesson_${lesson._id}`).emit(
      "lessonUpdated",
      {
        lessonId: lesson._id,
        newPrice: lesson.price,
        newTitle: lesson.title,
        requestedDate: lesson.requestedDate
      }
    );

  }

  /* =====================================
     RESPONSE
  ===================================== */

  return res.status(200).json({
    status: "success",
    message: "Lesson updated successfully.",
    data: lesson
  });
});
  
// =======================================================
// 7️⃣ STUDENT - CHOOSE TEACHER FOR LESSON
// =======================================================
exports.chooseTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId, teacherId } = req.params;

  const session = await mongoose.startSession();

  try {
    let finalLesson;

    await session.withTransaction(async () => {

      /* ======================================
         FIND LESSON
      ======================================= */

      const lesson = await Lesson.findOne({
        _id: lessonId,
        student: req.user._id,
        status: "pending",
        acceptedTeacher: null,
      }).session(session);

      if (!lesson) {
        throw new ApiError(
          "Lesson not found or already assigned",
          404
        );
      }

      /* ======================================
         CHECK LESSON TIME
      ======================================= */

      const now = new Date();
      const lessonTime = new Date(
        lesson.requestedDate
      ).getTime();

      /*
        URGENT / IMMEDIATE LESSON
        --------------------------------
        Can be selected within 6 hours
        after its requested time.
      */

      if (lesson.isUrgent) {

        const gracePeriod = 6 * 60 * 60 * 1000;

        if (
          lessonTime + gracePeriod <= now.getTime()
        ) {
          throw new ApiError(
            "This urgent lesson request has expired.",
            400
          );
        }

      } else {

        /*
          SCHEDULED LESSON
          --------------------------------
          Cannot be selected after its
          scheduled time.
        */

        if (lessonTime <= now.getTime()) {
          throw new ApiError(
            "Cannot choose a teacher for a lesson whose scheduled time has passed.",
            400
          );
        }
      }

      /* ======================================
         CHECK TEACHER INTEREST
      ======================================= */

      const teacherOffer =
        lesson.interestedTeachers.find(
          (item) => isSameId(item.teacher, teacherId)
        );

      if (!teacherOffer) {
        throw new ApiError(
          "This teacher has not expressed interest in this lesson.",
          400
        );
      }

      /* ======================================
         CHECK TEACHER AVAILABILITY
      ======================================= */

      await checkTeacherAvailability(
        teacherId,
        lesson.requestedDate,
        lesson.durationInMinutes
      );

      /* ======================================
         FIND ACCEPTED NEGOTIATION
      ======================================= */

      const acceptedThread = await Thread.findOne({
        lesson: lesson._id,
        teacher: teacherId,
        status: "accepted",
      }).session(session);

      /*
        Priority:
        1. Accepted negotiation price
        2. Teacher proposed price
        3. Original lesson price
      */

      const finalPrice =
        acceptedThread?.agreedPrice ??
        teacherOffer.proposedPrice ??
        lesson.price;

      /* ======================================
         PAYMENT PRICE PROTECTION
      ====================================== */

      if (
        lesson.paymentStatus === "paid" &&
        Number(lesson.price) !== Number(finalPrice)
      ) {
        throw new ApiError(
          "Cannot change price for a paid lesson.",
          400
        );
      }

      /* ======================================
         ATOMIC LESSON APPROVAL
      ======================================= */

      const updatedLesson =
        await Lesson.findOneAndUpdate(
          {
            _id: lessonId,
            student: req.user._id,
            status: "pending",
            acceptedTeacher: null,
          },
          {
            $set: {
              acceptedTeacher: teacherId,
              status: "approved",
              price: finalPrice,
            },
          },
          {
            new: true,
            session,
          }
        );

      /*
        If another chooseTeacher request
        succeeded at the same time,
        this request must fail.
      */

      if (!updatedLesson) {
        throw new ApiError(
          "This lesson has already been assigned to another teacher.",
          409
        );
      }

      finalLesson = updatedLesson;

      /* ======================================
         CLOSE OTHER NEGOTIATION THREADS
      ======================================= */

      await Thread.updateMany(
        {
          lesson: lessonId,
          _id: {
            $ne: acceptedThread?._id || null,
          },
          status: {
            $in: [
              "negotiating",
              "canceled",
              "timeout",
            ],
          },
        },
        {
          $set: {
            status: "closed",
          },
        },
        {
          session,
        }
      );

    });

    /* ======================================
       RESPONSE
    ====================================== */

    res.status(200).json({
      status: "success",
      message: "Teacher selected successfully.",
      data: {
        lesson: finalLesson,
      },
    });

    /* ======================================
       BACKGROUND NOTIFICATION
    ====================================== */

    setImmediate(() => {
      sendChooseTeacherNotification(
        finalLesson._id,
        teacherId,
        req.user
      );
    });

  } catch (err) {

    /* ======================================
       API ERROR
    ====================================== */

    if (err instanceof ApiError) {
      return next(err);
    }

    console.error(
      "chooseTeacher error:",
      err
    );

    return next(
      new ApiError(
        "Failed to choose teacher",
        500
      )
    );

  } finally {

    await session.endSession();

  }
});
// =======================================================
//  CREATE ZEGOCALL MEETING FOR LESSON WHEN STUDENT OR TEACHER STARTS THE LESSON
// =======================================================


exports.createMeeting = asyncHandler(async (req, res, next) => {
    const { lessonId } = req.params;

    const lesson = await Lesson.findById(lessonId);

    if (!lesson) return next(new ApiError("Lesson not found", 404));
    if (!isSameId(lesson.student, req.user._id) && !isSameId(lesson.acceptedTeacher, req.user._id)) {
      return next(
        new ApiError("You are not authorized to create meeting for this lesson", 403)
      );
    }

    if (lesson.status !== "approved") {
      return next(new ApiError("Lesson is not approved yet", 400));
    }

    if (!lesson.acceptedTeacher) {
      return next(new ApiError("No teacher assigned yet", 400));
    }
    if (
      lesson.paymentStatus !== "paid" ||
      lesson.fundsStatus === "refund_pending" ||
      lesson.fundsStatus === "refunded"
    ) {
        return next(new ApiError("Lesson is not available", 400));
    }
 
    if (lesson.meetingRoomId) {
      return res.status(200).json({
        status: "success",
        data: {
          meetingRoomId: lesson.meetingRoomId,
          tokens: {
            student: lesson.zegoTokenForStudent,
            teacher: lesson.zegoTokenForTeacher
          }
        }
      });
    }

    else {
      const {
        meetingRoomId,
        studentToken,
        teacherToken
      } = await createLessonMeeting({
        lesson,
        studentId: lesson.student,
        teacherId: lesson.acceptedTeacher,
        effectiveTimeInSeconds: (lesson.durationInMinutes * 60) + 3600  // Convert minutes to seconds and add 1 hour buffer
      });

      res.status(200).json({
        status: "success",
        data: {
          meetingRoomId,
          tokens: {
            student: studentToken,
            teacher: teacherToken
          }
        }
      });
  }

});



// =======================================================
// 8️⃣ STUDENT - GET INTERESTED TEACHERS FOR LESSON
// =======================================================
exports.getInterestedTeachers = asyncHandler(async (req, res, next) => {

  const { lessonId } = req.params;

  const lesson = await Lesson.findOne({
    _id: lessonId,
    student: req.user._id
  })
    .select("interestedTeachers")
    .populate({
      path: "interestedTeachers.teacher",
      select: `
        firstName 
        lastName 
        email 
        imageProfile 
        teacherProfile.subjects 
        teacherProfile.avgRating 
        teacherProfile.bio 
        teacherProfile.experienceYears
      `
    })
    .lean();

  if (!lesson) {
    return next(
      new ApiError("Lesson not found or not authorized", 404)
    );
  }

  const teachers = (lesson.interestedTeachers || []).map(item => ({
    ...item.teacher,
    proposedPrice: item.proposedPrice
  }));

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers
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

  } 
  else if (user.role === "teacher") {

    filter = {
      $or: [
        { acceptedTeacher: user._id },
        { "interestedTeachers.teacher": user._id }
      ]
    };

  } 
  else if (user.role === "admin") {

    filter = {};

  } 
  else {
    return next(new ApiError("You are not authorized to view lessons", 403));
  }

  const lessonsCount = await Lesson.countDocuments(filter);

  const apiFeatures = new ApiFeatures(
    Lesson.find(filter)
      .populate("student", "firstName lastName email studentProfile imageProfile")
      .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating imageProfile")
      .populate({
        path: "interestedTeachers.teacher",
        select: "firstName lastName email teacherProfile.avgRating imageProfile"
      }),
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
    .populate("student", "firstName lastName email studentProfile imageProfile")
    .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating imageProfile")
    .populate("interestedTeachers.teacher", "firstName lastName email teacherProfile.avgRating imageProfile")
    .select("student acceptedTeacher interestedTeachers title subject price durationInMinutes requestedDate  finalCompletionStatus");

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
        { "interestedTeachers.teacher": req.user._id }
      ]
    })
    .populate("student", "firstName lastName email studentProfile imageProfile")
    .select("student  title subject price durationInMinutes requestedDate finalCompletionStatus");


  if (!lesson) return next(new ApiError("Lesson not found", 404));

  

  res.status(200).json({
    status: "success",
    data: lesson,
  });
});

// =======================================================
//  TEACHER - GET LESSON BY ID IF LESSON NOT APPROVED YET (TO SEE STUDENT DETAILS BEFORE CHOOSING TEACHER)
// =======================================================
exports.getLessonDetailsById = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const lesson = await Lesson.findOne({
      _id: lessonId,
      status: "pending",
      "acceptedTeacher": null,
    })
    .populate("student", "firstName lastName email studentProfile imageProfile")
    .select("student  title subject price durationInMinutes requestedDate finalCompletionStatus");

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
  const role = user.role;

  const page = Math.max(1, +req.query.page || 1);
  const limit = Math.min(50, +req.query.limit || 10);
  const skip = (page - 1) * limit;

  const { subject, paymentStatus, from, to, sort } = req.query;

  /* ===============================
     BASE MATCH
  =============================== */

  let match = {};

  if (role === "student") {

    match.student = user._id;

    match.$or = [
      { status: "pending" },
      { status: "approved", paymentStatus: "unpaid" },
      { status: "approved", paymentStatus: "paid" },
      { status: "canceled", canceledBy: "teacher" }
    ];

  } else if (role === "teacher") {

    match.$or = [
      {
        status: "pending",
        "interestedTeachers.teacher": user._id,
        acceptedTeacher: null
      },
      {
        status: "approved",
        acceptedTeacher: user._id,
        //paymentStatus: "paid" 
      }
    ];

  } else {
    return next(new ApiError("Not authorized", 403));
  }

  if (subject) match.subject = subject;
  if (paymentStatus) match.paymentStatus = paymentStatus;

  if (from || to) {
    match.requestedDate = {};
    if (from) match.requestedDate.$gte = new Date(from);
    if (to) match.requestedDate.$lte = new Date(to);
  }

  /* ===============================
     PIPELINE
  =============================== */

  const pipeline = [

    { $match: match },

    /* ===============================
       TIME CALCULATIONS
    =============================== */

    {
      $addFields: {
        lessonEndTime: {
          $add: [
            "$requestedDate",
            { $multiply: ["$durationInMinutes", 60000] }
          ]
        }
      }
    },

    {
      $addFields: {
        baseEndTime: {
          $ifNull: ["$meetingEndTime", "$lessonEndTime"]
        }
      }
    },

    {
      $addFields: {
        expireAt: {
          $add: ["$baseEndTime", 15 * 60 * 1000] //  15 min
        }
      }
    },

    {
      $match: {
        $expr: {
          $gt: ["$expireAt", new Date()]
        }
      }
    },

    /* ===============================
       LESSON STATE
    =============================== */

    {
      $addFields: {
        lessonState: {
          $switch: {
            branches: [

              /* ===== STUDENT ===== */

              {
                case: {
                  $and: [
                    { $eq: [role, "student"] },
                    { $eq: ["$status", "pending"] }
                  ]
                },
                then: "waiting_teacher"
              },

              {
                case: {
                  $and: [
                    { $eq: [role, "student"] },
                    { $eq: ["$status", "approved"] },
                    { $eq: ["$paymentStatus", "unpaid"] }
                  ]
                },
                then: "awaiting_payment"
              },

              {
                case: {
                  $and: [
                    { $eq: [role, "student"] },
                    { $eq: ["$status", "approved"] },
                    { $eq: ["$paymentStatus", "paid"] }
                  ]
                },
                then: "confirmed"
              },

              {
                case: {
                  $and: [
                    { $eq: [role, "student"] },
                    { $eq: ["$status", "canceled"] },
                    { $eq: ["$canceledBy", "teacher"] }
                  ]
                },
                then: "cancelled_by_teacher"
              },

              /* ===== TEACHER ===== */

              {
                case: {
                  $and: [
                    { $eq: [role, "teacher"] },
                    { $eq: ["$status", "pending"] }
                  ]
                },
                then: "price_received"
              },

              {
                case: {
                  $and: [
                    { $eq: [role, "teacher"] },
                    { $eq: ["$status", "approved"] }
                  ]
                },
                then: "booked"
              }

            ],
            default: "unknown"
          }
        }
      }
    },

    /* ===============================
       POPULATE STUDENT
    =============================== */

    {
      $lookup: {
        from: "users",
        localField: "student",
        foreignField: "_id",
        as: "student"
      }
    },
    { $unwind: "$student" },

    /* ===============================
       POPULATE TEACHER
    =============================== */

    {
      $lookup: {
        from: "users",
        localField: "acceptedTeacher",
        foreignField: "_id",
        as: "acceptedTeacher"
      }
    },
    {
      $unwind: {
        path: "$acceptedTeacher",
        preserveNullAndEmptyArrays: true
      }
    },

    /* ===============================
       SELECT FIELDS
    =============================== */

    {
      $project: {
        title: 1,
        subject: 1,
        price: 1,

        proposedPrice: {
          $let: {
            vars: {
              teacherIndex: {
                $indexOfArray: [
                  "$interestedTeachers.teacher",
                  role === "teacher" ? user._id : "$acceptedTeacher._id"
                ]
              }
            },
            in: {
              $cond: [
                { $gte: ["$$teacherIndex", 0] },
                {
                  $arrayElemAt: [
                    "$interestedTeachers.proposedPrice",
                    "$$teacherIndex"
                  ]
                },
                "$price"
              ]
            }
          }
        },

        durationInMinutes: 1,
        requestedDate: 1,
        lessonEndTime: 1,
        expireAt: 1,
        paymentStatus: 1,
        lessonState: 1,

        "student.firstName": 1,
        "student.lastName": 1,
        "student.email": 1,
        "student.imageProfile": 1,

        "acceptedTeacher.firstName": 1,
        "acceptedTeacher.lastName": 1,
        "acceptedTeacher.email": 1,
        "acceptedTeacher.imageProfile": 1,
        "acceptedTeacher.teacherProfile.avgRating": 1
      }
    },

    { $sort: { requestedDate: sort === "desc" ? -1 : 1 } },

    { $skip: skip },

    { $limit: limit }

  ];

  const lessons = await Lesson.aggregate(pipeline);
  const total = await Lesson.countDocuments(match);

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

  let lesson = await Lesson.findById(lessonId);

  if (!lesson)
    return next(new ApiError("Lesson not found", 404));

  const io = getIO();

  const isStudent = isSameId(lesson.student, req.user._id);
  const isTeacher = isSameId(lesson.acceptedTeacher, req.user._id);

  if (!isStudent && !isTeacher)
    return next(new ApiError("Not authorized", 403));

  const diff = lesson.requestedDate.getTime() - Date.now();

  /* =====================================
      RELEASED MONEY
  ===================================== */

  if (lesson.fundsStatus === "released") {
    return next(
      new ApiError(
        "This lesson can no longer be cancelled because the funds have already been released.",
        400
      )
    );
  }

  /* =====================================
      REFUND ALREADY REQUESTED
  ===================================== */

  if (
    lesson.paymentStatus === "refund_pending" ||
    lesson.fundsStatus === "refund_pending"
  ) {
    return next(
      new ApiError(
        "Refund request already exists for this lesson.",
        400
      )
    );
  }

  /* =====================================
      ALREADY REFUNDED
  ===================================== */

  if (
    lesson.paymentStatus === "refunded" ||
    lesson.fundsStatus === "refunded"
  ) {
    return next(
      new ApiError(
        "This lesson has already been refunded.",
        400
      )
    );
  }

  /* =====================================
      15 MIN RULE
  ===================================== */

  if (
    diff < 15 * 60 * 1000 &&
    (lesson.paymentStatus === "paid" || lesson.acceptedTeacher)
  ) {
    return next(
      new ApiError(
        "Cannot cancel lesson within 15 minutes before its start.",
        400
      )
    );
  }

  /* =====================================
      STUDENT CANCEL
  ===================================== */

  if (isStudent) {

    if (lesson.status === "canceled") {
      return next(new ApiError("Lesson already canceled", 400));
    }

    if (lesson.paymentStatus === "paid") {

      if (diff < 24 * 60 * 60 * 1000) {
        return next(
          new ApiError(
            "Paid lessons can only be cancelled at least 24 hours before the lesson starts.",
            400
          )
        );
      }

      await handleRefund({
        lessonId: lesson._id,
        requestedBy: req.user._id,
        reason: "Student cancelled the lesson"
      });

      lesson = await Lesson.findById(lesson._id);

    } else {

      lesson.status = "canceled";
      lesson.canceledBy = "student";

      await lesson.save();

    }

    if (lesson.acceptedTeacher) {
      await deductPoints(lesson.student, 15);
    }

  }

  /* =====================================
      TEACHER CANCEL
  ===================================== */

  if (isTeacher) {

    if (lesson.paymentStatus === "paid") {

      await handleRefund({
        lessonId: lesson._id,
        requestedBy: req.user._id,
        reason: "Teacher cancelled the lesson"
      });

      lesson = await Lesson.findById(lesson._id);

      lesson.acceptedTeacher = null;

      lesson.interestedTeachers =
        lesson.interestedTeachers.filter(
          t => !isSameId(t.teacher, req.user._id)
        );
      lesson.canceledBy = "teacher";
      await lesson.save();

    } else {

      lesson.acceptedTeacher = null;

      lesson.status = "pending";

      lesson.canceledBy = "teacher";

      lesson.interestedTeachers =
        lesson.interestedTeachers.filter(
          t => !isSameId(t.teacher, req.user._id)
        );

      await lesson.save();

    }

  }

    /* =====================================
      SOCKET EVENTS
  ===================================== */

  if (io) {

    if (isStudent) {

      io.to(`lesson_${lesson._id}`).emit("lessonCanceled", {
        lessonId: lesson._id,
        canceledBy: "student"
      });

      if (lesson.acceptedTeacher) {
        io.to(`user_${lesson.acceptedTeacher}`).emit("lessonCanceled", {
          lessonId: lesson._id
        });
      }

      io.to(`subject_${lesson.subject}`).emit("lessonRemoved", {
        lessonId: lesson._id
      });

    }

    if (isTeacher) {

      io.to(`lesson_${lesson._id}`).emit("teacherCanceledLesson", {
        lessonId: lesson._id,
        teacherId: req.user._id
      });

      io.to(`user_${lesson.student}`).emit("teacherCanceledLesson", {
        lessonId: lesson._id,
        teacherId: req.user._id
      });

      // لو الدرس غير مدفوع نرجعه يظهر للمدرسين
      if (lesson.paymentStatus !== "refund_pending") {

        io.to(`subject_${lesson.subject}`).emit("newLessonRequest", {
          _id: lesson._id,
          title: lesson.title,
          subject: lesson.subject,
          price: lesson.price,
          requestedDate: lesson.requestedDate
        });

      }

    }

  }

  /* =====================================
      RESPONSE
  ===================================== */

  res.status(200).json({
    status: "success",
    message:
      lesson.paymentStatus === "refund_pending"
        ? "Lesson cancelled successfully. Refund request has been created."
        : "Lesson cancelled successfully.",
    data: lesson
  });

  /* =====================================
      BACKGROUND NOTIFICATION
  ===================================== */

  setImmediate(() => {

    cancelLessonNotification(
      lesson,
      req.user._id,
      isStudent
    );

  });

});
