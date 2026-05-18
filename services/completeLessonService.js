const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const CompleteLesson = require("../models/completeLossonModel");
const Review = require("../models/reviewModel");
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
      studentSubmission.reviewStatus = "auto_resolved";
      teacherSubmission.reviewStatus = "auto_resolved";
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
        //  كانوا متفقين إن فيه مشكلة
        lesson.finalCompletionStatus = "incomplete";
        lesson.reviewStatus = "under_admin_review"; 
        lesson.disputeFlag = false; 
        studentSubmission.reviewStatus = "under_admin_review";
        teacherSubmission.reviewStatus = "under_admin_review";

      } else {
        lesson.reviewStatus = "disputed";
        lesson.disputeFlag = true;
        studentSubmission.reviewStatus = "disputed";
        teacherSubmission.reviewStatus = "disputed";
      }
    }

    // واحد completed والتاني incomplete
    else {
      lesson.reviewStatus = "disputed";
      lesson.disputeFlag = true;
      studentSubmission.reviewStatus = "disputed";
      teacherSubmission.reviewStatus = "disputed";
    }

    await lesson.save();
    await studentSubmission.save();
    await teacherSubmission.save();
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

  const { subject, from, to, minPrice, maxPrice, sort, reviewed } = req.query;

  /* =====================================
     BASE FILTER
  ===================================== */

  const match = {
    finalCompletionStatus: "completed",
    meetingEndTime: { $ne: null }
  };

  if (user.role === "student") {
    match.student = user._id;
  } 
  else if (user.role === "teacher") {
    match.acceptedTeacher = user._id;
  } 
  else {
    return next(new ApiError("You are not authorized", 403));
  }

  /* =====================================
     OPTIONAL FILTERS
  ===================================== */

  if (subject) {
    match.subject = subject;
  }

  if (from || to) {
    match.meetingEndTime = {
      ...(from && { $gte: new Date(from) }),
      ...(to && { $lte: new Date(to) })
    };
  }

  if (minPrice || maxPrice) {
    match.price = {};
    if (minPrice) match.price.$gte = Number(minPrice);
    if (maxPrice) match.price.$lte = Number(maxPrice);
  }

  /* =====================================
     AGGREGATION PIPELINE
  ===================================== */

  const pipeline = [

    { $match: match },

    // ======================
    // join reviews
    // ======================
    {
      $lookup: {
        from: "reviews",
        localField: "_id",
        foreignField: "lesson",
        as: "review"
      }
    },

    // ======================
    // add hasReview flag
    // ======================
    {
      $addFields: {
        hasReview: { $gt: [{ $size: "$review" }, 0] }
      }
    },

    // ======================
    // filter by reviewed
    // ======================
    ...(reviewed === "true" ? [{ $match: { hasReview: true } }] : []),
    ...(reviewed === "false" ? [{ $match: { hasReview: false } }] : []),

    // ======================
    // populate student
    // ======================
    {
      $lookup: {
        from: "users",
        localField: "student",
        foreignField: "_id",
        as: "student"
      }
    },
    { $unwind: "$student" },

    // ======================
    // populate teacher
    // ======================
    {
      $lookup: {
        from: "users",
        localField: "acceptedTeacher",
        foreignField: "_id",
        as: "acceptedTeacher"
      }
    },
    { $unwind: "$acceptedTeacher" },

    // ======================
    // reshape review (take first)
    // ======================
    {
      $addFields: {
        review: { $arrayElemAt: ["$review", 0] }
      }
    },

    // ======================
    // select fields
    // ======================
    {
      $project: {
        title: 1,
        subject: 1,
        price: 1,
        durationInMinutes: 1,
        requestedDate: 1,
        meetingEndTime: 1,
        finalCompletionStatus: 1,
        reviewStatus: 1,

        "student.firstName": 1,
        "student.lastName": 1,
        "student.email": 1,
        "student.imageProfile": 1,
        "student.studentProfile": 1,

        "acceptedTeacher.firstName": 1,
        "acceptedTeacher.lastName": 1,
        "acceptedTeacher.email": 1,
        "acceptedTeacher.imageProfile": 1,
        "acceptedTeacher.teacherProfile.avgRating": 1,

        review: 1,
        hasReview: 1
      }
    },

    // ======================
    // sorting
    // ======================
    {
      $sort: sort ? { [sort]: -1 } : { meetingEndTime: -1 }
    },

    // ======================
    // pagination
    // ======================
    { $skip: skip },
    { $limit: limit }
  ];

  /* =====================================
     EXECUTE
  ===================================== */

  const lessons = await Lesson.aggregate(pipeline);

  /* =====================================
     TOTAL COUNT (important)
  ===================================== */

  const countPipeline = [
    { $match: match },

    {
      $lookup: {
        from: "reviews",
        localField: "_id",
        foreignField: "lesson",
        as: "review"
      }
    },
    {
      $addFields: {
        hasReview: { $gt: [{ $size: "$review" }, 0] }
      }
    },
    ...(reviewed === "true" ? [{ $match: { hasReview: true } }] : []),
    ...(reviewed === "false" ? [{ $match: { hasReview: false } }] : []),

    { $count: "total" }
  ];

  const totalResult = await Lesson.aggregate(countPipeline);
  const total = totalResult[0]?.total || 0;

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

  const { reviewStatus, from, to } = req.query;

  /* ===========================
     MATCH
  ============================ */

  const match = {
    $and: [
      {
        $or: [
          { status: "problem" },
          { reviewStatus: { $in: ["disputed", "under_admin_review", "resolved_by_admin"] } }
        ]
      },
      {
        $or: [
          { student: userId },
          { acceptedTeacher: userId }
        ]
      }
    ]
  };

  if (reviewStatus) match.reviewStatus = reviewStatus;

  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }

  /* ===========================
     PIPELINE
  ============================ */

  const pipeline = [
    { $match: match },

    /* ===========================
       JOIN REVIEW 
    ============================ */
    {
      $lookup: {
        from: "reviews",
        localField: "_id",
        foreignField: "lesson",
        as: "review"
      }
    },

    {
      $addFields: {
        review: { $arrayElemAt: ["$review", 0] }
      }
    },

    /* ===========================
       POPULATE STUDENT
    ============================ */
    {
      $lookup: {
        from: "users",
        localField: "student",
        foreignField: "_id",
        as: "student"
      }
    },
    { $unwind: "$student" },

    /* ===========================
       POPULATE TEACHER
    ============================ */
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

    /* ===========================
       SORT
    ============================ */
    { $sort: { createdAt: -1 } },

    /* ===========================
       FACET (pagination + total)
    ============================ */
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

  const result = await Lesson.aggregate(pipeline);

  const data = result[0]?.data || [];
  const total = result[0]?.metadata[0]?.total || 0;

  /* ===========================
     RESPONSE
  ============================ */

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