const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const CompleteLesson = require("../models/completeLossonModel");
const Notification = require("../models/notificationModel");


exports.submitCompletion = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { completionStatus, reasonForIncomplete, description } = req.body;

  const proofImage = req.files?.proofImage ? req.proofImageUrl : null;
  const user = req.user;

  // ======================
  // 1. Validate lesson
  // ======================
  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  // ======================
  // 2. Determine role
  // ======================
  let role;

  if (lesson.student.toString() === user._id.toString()) {
    role = "student";
  } else if (lesson.acceptedTeacher?.toString() === user._id.toString()) {
    role = "teacher";
  } else {
    return next(new ApiError("Not authorized for this lesson", 403));
  }

  // ======================
  // 3. Prevent duplicate submission
  // ======================
  const existing = await CompleteLesson.findOne({
    lesson: lessonId,
    role,
  });

  if (existing) {
    return next(new ApiError("You already submitted completion", 400));
  }

  // ======================
  // 4. Validate input
  // ======================
  if (!["completed", "incomplete"].includes(completionStatus)) {
    return next(new ApiError("Invalid completion status", 400));
  }

  if (completionStatus === "incomplete" && !reasonForIncomplete) {
    return next(new ApiError("Reason is required for incomplete status", 400));
  }

  // ======================
  // 5. Create submission
  // ======================
  const submission = await CompleteLesson.create({
    lesson: lessonId,
    submittedBy: user._id,
    role,
    completionStatus,
    reasonForIncomplete,
    description,
    proofImage,
  });

  const submissions = await CompleteLesson.find({ lesson: lessonId });

  // ======================
  // 6. LOGIC (Optimistic)
  // ======================

  //  الحالة 1: أول submission
  if (submissions.length === 1) {
    const first = submissions[0];

    if (first.completionStatus === "completed") {
      // نفترض إن الحصة تمت
      lesson.finalCompletionStatus = "completed";
      lesson.reviewStatus = "waiting_second_party";
      lesson.disputeFlag = false;

    } else {
      // فيه مشكلة محتملة
      lesson.finalCompletionStatus = "pending";
      lesson.reviewStatus = "waiting_second_party";
      lesson.disputeFlag = true;
    }

    await lesson.save();

    return res.status(201).json({
      status: "success",
      data: submission,
    });
  }

  //  الحالة 2: الاتنين submit
  if (submissions.length === 2) {
    const studentSubmission = submissions.find(s => s.role === "student");
    const teacherSubmission = submissions.find(s => s.role === "teacher");

    // الاتنين completed
    if (
      studentSubmission.completionStatus === "completed" &&
      teacherSubmission.completionStatus === "completed"
    ) {
      lesson.finalCompletionStatus = "completed";
      lesson.reviewStatus = "auto_resolved";
      lesson.disputeFlag = false;
    }

    // الاتنين incomplete
    else if (
      studentSubmission.completionStatus === "incomplete" &&
      teacherSubmission.completionStatus === "incomplete"
    ) {
      if (
        studentSubmission.reasonForIncomplete ===
        teacherSubmission.reasonForIncomplete
      ) {
        // 👇 كانوا متفقين إن فيه مشكلة
        lesson.finalCompletionStatus = "incomplete";
        lesson.reviewStatus = "under_admin_review"; 
        lesson.disputeFlag = false; 
      } else {
        lesson.reviewStatus = "disputed";
        lesson.disputeFlag = true;
      }
    }

    // واحد completed والتاني incomplete
    else {
      lesson.reviewStatus = "disputed";
      lesson.disputeFlag = true;
    }

    await lesson.save();
  }

  // ======================
  // 7. Response
  // ======================
  res.status(201).json({
    status: "success",
    data: submission,
  });
});

exports.getDisputedLessons = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "admin") {
    return next(new ApiError("Not authorized", 403));
  }

  const lessons = await Lesson.find({
    reviewStatus: { $in: ["disputed", "under_admin_review"] },
  }).populate("student acceptedTeacher");

  res.status(200).json({
    status: "success",
    results: lessons.length,
    data: lessons,
  });
});

exports.adminResolveLesson = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "admin") {
    return next(new ApiError("Not authorized", 403));
  }

  const { lessonId } = req.params;
  const { finalStatus, adminNote } = req.body;

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  if (lesson.reviewStatus !== "disputed") {
    return next(new ApiError("Lesson is not in disputed state", 400));
  }

  lesson.finalCompletionStatus = finalStatus;
  lesson.reviewStatus = "resolved_by_admin";
  lesson.disputeFlag = false;

  await lesson.save();

  // تحديث submissions
  await CompleteLesson.updateMany(
    { lesson: lessonId },
    {
      "adminReview.status": "approved",
      "adminReview.reviewedBy": req.user._id,
      "adminReview.reviewedAt": new Date(),
      "adminReview.adminNote": adminNote,
    }
  );

  res.status(200).json({
    status: "success",
    message: "Lesson resolved successfully",
  });
});



// =======================================================
// GET PAST LESSONS FOR TEACHER/STUDENT COMPLETED WITHOUT ISSUES
// =======================================================
exports.getPastCompletedLessons = asyncHandler(async (req, res, next) => {

  const user = req.user;

  const page = Math.max(1, +req.query.page || 1);
  const limit = Math.min(50, +req.query.limit || 10);
  const skip = (page - 1) * limit;

  const { subject, from, to, minPrice, maxPrice, sort } = req.query;

  /* =====================================
     BASE FILTER
  ===================================== */

  const filter = {
    finalCompletionStatus: "completed",
    meetingEndTime: { $ne: null }
  };

  if (user.role === "student") {
    filter.student = user._id;
  } 
  else if (user.role === "teacher") {
    filter.acceptedTeacher = user._id;
  } 
  else {
    return next(new ApiError("You are not authorized", 403));
  }

  /* =====================================
     OPTIONAL FILTERS
  ===================================== */

  if (subject) {
    filter.subject = subject;
  }

  if (from || to) {
    filter.meetingEndTime = {
      ...(from && { $gte: new Date(from) }),
      ...(to && { $lte: new Date(to) })
    };
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  /* =====================================
     TOTAL
  ===================================== */

  const total = await Lesson.countDocuments(filter);

  /* =====================================
     QUERY
  ===================================== */

  const lessons = await Lesson.find(filter)
    .populate("student", "firstName lastName email studentProfile")
    .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating")
    .select("title subject price durationInMinutes requestedDate meetingEndTime")
    .sort(sort || "-meetingEndTime")
    .skip(skip)
    .limit(limit);

  /* =====================================
     RESPONSE
  ===================================== */

  res.status(200).json({
    status: "success",
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
    results: lessons.length,
    data: lessons,
  });

});


// =======================================================
// GET past lessons with issues (problem, disputed, under_admin_review) FOR TEACHER/STUDENT
// =======================================================

exports.getProblematicPastLessons = asyncHandler(async (req, res, next) => {

  const userId = req.user._id;
  const page = Math.max(1, +req.query.page || 1);
  const limit = Math.min(50, +req.query.limit || 10);
  const skip = (page - 1) * limit;

  const { reviewStatus, role, from, to } = req.query;

  /* ===========================
     MATCH CONDITIONS
  ============================ */

  const matchStage = {
    reviewStatus: { $in: ["disputed", "under_admin_review" , "resolved_by_admin"] }
  };

  if (reviewStatus) {
    matchStage.reviewStatus = reviewStatus;
  }

  if (role) {
    matchStage.role = role;
  }

  if (from || to) {
    matchStage.createdAt = {};
    if (from) matchStage.createdAt.$gte = new Date(from);
    if (to) matchStage.createdAt.$lte = new Date(to);
  }

  /* ===========================
     AGGREGATION
  ============================ */

  const pipeline = [

    { $match: matchStage },

    {
      $lookup: {
        from: "lessons",
        localField: "lesson",
        foreignField: "_id",
        as: "lesson"
      }
    },

    { $unwind: "$lesson" },

    {
      $match: {
        "lesson.finalCompletionStatus": "incomplete",
        $or: [
          { "lesson.student": userId },
          { "lesson.acceptedTeacher": userId }
        ]
      }
    },

    /* ===========================
       POPULATE STUDENT
    ============================ */

    {
      $lookup: {
        from: "users",
        localField: "lesson.student",
        foreignField: "_id",
        as: "lesson.student"
      }
    },
    { $unwind: "$lesson.student" },

    /* ===========================
       POPULATE TEACHER
    ============================ */

    {
      $lookup: {
        from: "users",
        localField: "lesson.acceptedTeacher",
        foreignField: "_id",
        as: "lesson.acceptedTeacher"
      }
    },
    { $unwind: "$lesson.acceptedTeacher" },

    { $sort: { createdAt: -1 } },

    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $skip: skip },
          { $limit: limit }
        ]
      }
    }

  ];

  const result = await CompleteLesson.aggregate(pipeline);

  const total = result[0].metadata[0]?.total || 0;
  const data = result[0].data;

  res.status(200).json({
    status: "success",
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    results: data.length,
    data
  });

});

exports.getExpiredLessons = asyncHandler(async (req, res, next) => {

  const user = req.user;

  const page = Math.max(1, +req.query.page || 1);
  const limit = Math.min(50, +req.query.limit || 10);
  const skip = (page - 1) * limit;

  const { subject, from, to, sort } = req.query;

  const now = new Date();

  /* =====================================
     BASE FILTER
  ===================================== */

  let match = {
    meetingStartTime: null // ❗ أهم شرط
  };

  if (user.role === "student") {
    match.student = user._id;
  } 
  else if (user.role === "teacher") {
    match.acceptedTeacher = user._id;
  } 
  else {
    return next(new ApiError("Not authorized", 403));
  }

  if (subject) match.subject = subject;

  /* =====================================
     PIPELINE
  ===================================== */

  const pipeline = [

    { $match: match },

    /* ===============================
       CALCULATE END TIME
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
        expireAt: {
          $add: ["$lessonEndTime", 15 * 60 * 1000] // ⏱️ 15 min buffer
        }
      }
    },

    /* ===============================
       EXPIRED FILTER
    =============================== */

    {
      $match: {
        $expr: {
          $lt: ["$expireAt", now]
        }
      }
    },

    /* ===============================
       OPTIONAL DATE FILTER
    =============================== */

    ...(from || to
      ? [{
          $match: {
            requestedDate: {
              ...(from && { $gte: new Date(from) }),
              ...(to && { $lte: new Date(to) })
            }
          }
        }]
      : []),

    /* ===============================
       POPULATE
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
       SELECT
    =============================== */

    {
      $project: {
        title: 1,
        subject: 1,
        price: 1,
        requestedDate: 1,
        lessonEndTime: 1,
        expireAt: 1,

        "student.firstName": 1,
        "student.lastName": 1,

        "acceptedTeacher.firstName": 1,
        "acceptedTeacher.lastName": 1
      }
    },

    { $sort: { requestedDate: sort === "desc" ? -1 : 1 } },

    { $skip: skip },
    { $limit: limit }

  ];

  const lessons = await Lesson.aggregate(pipeline);

  const total = lessons.length; 

  res.status(200).json({
    status: "success",
    page,
    limit,
    total,
    results: lessons.length,
    data: lessons
  });

});