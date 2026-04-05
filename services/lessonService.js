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
const { sendLessonNotifications , sendInterestNotification , sendChooseTeacherNotification , cancelLessonNotification } = require("../utils/lessonNotificaionHelper");
const {checkTeacherAvailability} = require("../utils/helpers");
const { createLessonMeeting } = require("./zegoService");

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
    "firstName lastName email fcmToken preferredLang teacherProfile.pricePerHour imageProfile"
  );

  // fallback لو مفيش حد في الرينج
  if (!teachers.length) {
    teachers = await User.find(
      {
        role: "teacher",
        "teacherProfile.subjects": subject
      },
      "firstName lastName email fcmToken preferredLang imageProfile"
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

  const teacher = await User.findById(req.user._id)
    .select("teacherProfile.subjects")
    .lean();

  if (!teacher?.teacherProfile?.subjects?.length) {
    return next(
      new ApiError("Teacher has no subjects configured in profile", 400)
    );
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {
    subject: { $in: teacher.teacherProfile.subjects },
    status: "pending",
    "interestedTeachers.teacher": { $ne: req.user._id }
  };

  const [lessons, total] = await Promise.all([
    Lesson.aggregate([
      { $match: filter },

      {
        $addFields: {
          interestedTeachersCount: { $size: "$interestedTeachers" }
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

          "student.firstName": 1,
          "student.lastName": 1,
          "student.studentProfile": 1,
          "student.imageProfile": 1
        }
      },

      { $sort: { createdAt: -1 } },
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

  if (proposedPrice && proposedPrice <= 0) {
    return next(new ApiError("Invalid proposed price", 400));
  }


  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  const io = getIO();


  /* =============================
     REJECT
  ============================== */
  if (response === "reject") {

    lesson.interestedTeachers = lesson.interestedTeachers.filter(
      (item) => !isSameId(item.teacher, teacherId)
    );

    await lesson.save();

    if (io) {
      io.to(`subject_${lesson.subject}`).emit("lessonRemoved", {
        lessonId: lesson._id,
        teacherId
      });
    }

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

  await checkTeacherAvailability(teacherId, lesson.requestedDate, lesson.durationInMinutes);

  /* =============================
     ADD OR UPDATE INTEREST
  ============================== */

  const existing = lesson.interestedTeachers.find(item =>
    isSameId(item.teacher, teacherId)
  );

  if (existing) {
    existing.proposedPrice = proposedPrice || lesson.price;
  } else {
    lesson.interestedTeachers.push({
      teacher: teacherId,
      proposedPrice: proposedPrice || lesson.price
    });
  }

  await lesson.save();

  /* =============================
     REALTIME EVENTS
  ============================== */

  if (io) {

    // notify student private room
    io.to(`user_${lesson.student}`).emit("teacherInterested", {
      lessonId: lesson._id,
      teacherId,
      proposedPrice: proposedPrice || lesson.price
    });

    // update lesson room
    io.to(`lesson_${lesson._id}`).emit("interestedTeachersUpdated", {
      lessonId: lesson._id,
      teacherId,
      proposedPrice: proposedPrice || lesson.price
    });
  }

  /* =============================
     RESPONSE FIRST
  ============================== */

  res.status(200).json({
    message: "Response saved successfully.",
    data: lesson
  });

  /* =============================
     BACKGROUND NOTIFICATION
  ============================== */

  setImmediate(() => {
    sendInterestNotification(lesson, req.user , proposedPrice);
  });
});
// =======================================================
// 6️⃣ STUDENT - UPDATE LESSON PRICE REQUEST
// =======================================================
exports.updateLessonRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { newPrice,newTitle,newDescription,newDate } = req.body;

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
  lesson.title = newTitle || lesson.title;
  lesson.description = newDescription || lesson.description;
  lesson.requestedDate = newDate ? new Date(newDate) : lesson.requestedDate;
  await lesson.save();

  const io = getIO();
  if (io) {
    io.to(`lesson_${lesson._id}`).emit("lessonPriceUpdated", {
      lessonId: lesson._id,
      newPrice
    });
  }


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

  const lesson = await Lesson.findOneAndUpdate(
  {
    _id: lessonId,
    student: req.user._id,
    status: "pending",
    "interestedTeachers.teacher": teacherId
  },
  {
    $set: {
      acceptedTeacher: teacherId,
      status: "approved"
    }
  },
  { new: true }
);



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
    await lesson.save();

  }


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
        paymentStatus: "paid" 
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

  const lesson = await Lesson.findById(lessonId);

  if (!lesson)
    return next(new ApiError("Lesson not found", 404));

  const io = getIO();

  const isStudent = isSameId(lesson.student, req.user._id);
  const isTeacher = isSameId(lesson.acceptedTeacher, req.user._id);

  if (!isStudent && !isTeacher)
    return next(new ApiError("Not authorized", 403));

  // prevent cancellation if less than 15 minutes to start
  const diff = lesson.requestedDate - Date.now()

  if(diff < 15 * 60 * 1000)
    return next(new ApiError("Cannot cancel lesson 15 minutes before start",400));

  /* =========================
     BLOCK AFTER PAYMENT
  ========================== */

  if (
    lesson.paymentStatus === "paid" ||
    lesson.paymentStatus === "released"
  ) {
    return next(
      new ApiError(
        "Cannot cancel a lesson that has already been paid",
        400
      )
    );
  }

  /* =========================
     STUDENT CANCEL LESSON
  ========================== */

  if (isStudent) {

    if (lesson.status === "canceled")
      return next(new ApiError("Lesson already canceled", 400));

    lesson.status = "canceled";
    lesson.canceledBy = "student";

    await lesson.save();

    if (io) {

      io.to(`lesson_${lesson._id}`).emit("lessonCanceled", {
        lessonId: lesson._id,
        canceledBy: "student"
      });

      io.to(`user_${lesson.acceptedTeacher}`).emit("lessonCanceled", {
        lessonId: lesson._id
      });

      io.to(`subject_${lesson.subject}`).emit("lessonRemoved", {
        lessonId: lesson._id
      });

    }

    // deduct points
    await deductPoints(lesson.student, 15);

  }

  /* =========================
     TEACHER CANCEL
  ========================== */

  if (isTeacher) {

    lesson.acceptedTeacher = null;
    lesson.status = "pending";
    lesson.canceledBy = "teacher";

    await lesson.save();

    if (io) {

      io.to(`lesson_${lesson._id}`).emit("teacherCanceledLesson", {
        lessonId: lesson._id,
        teacherId: req.user._id
      });

      io.to(`user_${lesson.student}`).emit("teacherCanceledLesson", {
        lessonId: lesson._id,
        teacherId: req.user._id
      });

      // يظهر الدرس مرة أخرى للمدرسين
      io.to(`subject_${lesson.subject}`).emit("newLessonRequest", {
        _id: lesson._id,
        title: lesson.title,
        subject: lesson.subject,
        price: lesson.price,
        requestedDate: lesson.requestedDate
      });

    }

  }

  res.status(200).json({
    status: "success",
    message: "Lesson cancellation processed",
    data: lesson
  });

  /* =========================
     BACKGROUND NOTIFICATION
  ========================== */
  setImmediate(() => {
    cancelLessonNotification(lesson, req.user._id , req.user.role === "student" );
  });

});
