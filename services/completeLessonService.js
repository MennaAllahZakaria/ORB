const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const CompleteLesson = require("../models/completeLossonModel");
const Notification = require("../models/notificationModel");

const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");
const { generateZegoToken } = require("../utils/zego");
const { addPoints, deductPoints } = require("./pointsService");

const admin = require("../fireBase/admin");
const sendEmail = require("../utils/sendEmail"); 
const ApiFeatures = require("../utils/apiFeatures");


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

