const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const CompleteLesson = require("../models/completeLossonModel");
const Notification = require("../models/notificationModel");


exports.submitCompletion = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { completionStatus, reasonForIncomplete, description } = req.body;

   let proofImage = req.body.proofImage || "";

   if (req.files?.proofImage) {
    proofImage = req.proofImageUrl;
  }

  const user = req.user;

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  let role;

  if (lesson.student.toString() === user._id.toString()) {
    role = "student";
  } else if (lesson.acceptedTeacher?.toString() === user._id.toString()) {
    role = "teacher";
  } else {
    return next(new ApiError("Not authorized for this lesson", 403));
  }

  const existing = await CompleteLesson.findOne({
    lesson: lessonId,
    role,
  });

  if (existing) {
    return next(new ApiError("You already submitted completion", 400));
  }

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

  if (first.completionStatus === second.completionStatus) {

  if (first.completionStatus === "completed") {
    lesson.finalCompletionStatus = "completed";
    lesson.reviewStatus = "auto_resolved";
    lesson.disputeFlag = false;

  } else {
    // الحالة incomplete
    if (first.reasonForIncomplete === second.reasonForIncomplete) {

      lesson.finalCompletionStatus = "incomplete";
      lesson.reviewStatus = "auto_resolved";
      lesson.disputeFlag = false;

    } else {
      lesson.reviewStatus = "disputed";
      lesson.disputeFlag = true;
    }
  }

} else {
  lesson.reviewStatus = "disputed";
  lesson.disputeFlag = true;
}

  if (submissions.length === 2) {
    const [first, second] = submissions;

    if (first.completionStatus === second.completionStatus) {

    if (first.completionStatus === "completed") {
        lesson.finalCompletionStatus = "completed";
        lesson.reviewStatus = "auto_resolved";
        lesson.disputeFlag = false;

    } else {
        // الحالة incomplete
        if (first.reasonForIncomplete === second.reasonForIncomplete) {

        lesson.finalCompletionStatus = "incomplete";
        lesson.reviewStatus = "auto_resolved";
        lesson.disputeFlag = false;

        } else {
        lesson.reviewStatus = "disputed";
        lesson.disputeFlag = true;
        }
    }

    } else {
        lesson.reviewStatus = "disputed";
        lesson.disputeFlag = true;
    }


    await lesson.save();
  }

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
    requestedDate: { $lt: new Date() },
    status: "approved",
    completion: "completed"
  };

  if (user.role === "student") {
    filter.student = user._id;
  } 
  else if (user.role === "teacher") {
    filter.acceptedTeacher = user._id;
  } 
  else {
    return next(new ApiError("You are not authorized to view lessons", 403));
  }

  /* =====================================
     OPTIONAL FILTERS
  ===================================== */

  if (subject) {
    filter.subject = subject;
  }

  if (from || to) {
    filter.requestedDate = {};
    if (from) filter.requestedDate.$gte = new Date(from);
    if (to) filter.requestedDate.$lte = new Date(to);
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  /* =====================================
     TOTAL COUNT
  ===================================== */

  const total = await Lesson.countDocuments(filter);

  /* =====================================
     QUERY
  ===================================== */

  const lessons = await Lesson.find(filter)
    .populate("student", "firstName lastName email studentProfile")
    .populate("acceptedTeacher", "firstName lastName email teacherProfile.avgRating")
    .select("title subject price durationInMinutes requestedDate")
    .sort(sort || "-requestedDate")
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

