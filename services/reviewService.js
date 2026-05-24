const asyncHandler = require("express-async-handler");
const HandlerFactory = require("./handlerFactory");
const Review = require("../models/reviewModel");
const Lesson = require("../models/lessonModel");
const User = require("../models/userModel");
const { addPoints, deductPoints } = require("./pointsService");
const ApiFeatures = require("../utils/apiFeatures");
const ApiError = require("../utils/apiError");
const { sendNotification } = require("../utils/notificationHelper");

// ===============================
// Helper: recalculate teacher rating
// ===============================
const recalcTeacherRating = async (teacherId) => {
  if (!teacherId) return;

  const stats = await Review.aggregate([
    { $match: { teacher: teacherId } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ]);

  const avgRating = stats.length > 0 ? stats[0].avgRating : 0;
  const totalReviews = stats.length > 0 ? stats[0].totalReviews : 0;

  await User.findByIdAndUpdate(teacherId, {
    "teacherProfile.avgRating": avgRating,
    "teacherProfile.totalReviews": totalReviews,
  });
};

// ===============================
// 🎯 Create new review
// ===============================
exports.createReview = asyncHandler(async (req, res, next) => {
  const { lessonId, rating, comment } = req.body;

  if (!lessonId) {
    return next(new ApiError("lessonId is required", 400));
  }

  if (rating == null || typeof rating !== "number") {
    return next(new ApiError("rating is required and must be a number", 400));
  }

  if (rating < 1 || rating > 5) {
    return next(new ApiError("rating must be between 1 and 5", 400));
  }

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  // Student can only review their own lessons
  if (lesson.student.toString() !== req.user._id.toString()) {
    return next(new ApiError("You can only review your own lessons", 403));
  }

  // Lesson must be completed
  if (lesson.finalCompletionStatus !== "completed") {
    return next(
      new ApiError("You can only review the lesson after it is completed", 400)
    );
  }

  if (!lesson.acceptedTeacher) {
    return next(
      new ApiError("This lesson has no assigned teacher to review", 400)
    );
  }

  // One review per (lesson + student)
  const existing = await Review.findOne({
    lesson: lessonId,
    student: req.user._id,
  });
  if (existing) {
    return next(
      new ApiError("You have already submitted a review for this lesson", 400)
    );
  }

  // Create review
  const review = await Review.create({
    lesson: lessonId,
    student: req.user._id,
    teacher: lesson.acceptedTeacher,
    rating,
    comment,
  });

  // Add points to student for writing review
  await addPoints(req.user._id, 10, "Review submitted");

  // Recalculate teacher rating
  await recalcTeacherRating(lesson.acceptedTeacher);

  // Notify Teacher about new review
  const teacher = await User.findById(lesson.acceptedTeacher);
  if (teacher) {
    setImmediate(() => {
      sendNotification({
        recipient: teacher,
        titleEn: "⭐ New Review Received",
        titleAr: "⭐ تقييم جديد",
        bodyEn: `A student has left a ${rating}-star review for your lesson "${lesson.title}".`,
        bodyAr: `قام طالب بترك تقييم ${rating} نجوم لحصتك "${lesson.title}".`,
        data: { type: "new_review", lessonId: lesson._id.toString() }
      });
    });
  }

  res.status(201).json({
    status: "success",
    data: review,
  });
});

// ===============================
// 📋 Get all reviews (admin or public, depending on your policy)
// ===============================
exports.getAllReviews = HandlerFactory.getAll(Review);

// ===============================
// 📋 Get all reviews for specific teacher
// ===============================
exports.getAllReviewsForTeacher = asyncHandler(async (req, res, next) => {
  const { teacherId } = req.params;

  if (!teacherId) {
    return next(new ApiError("Teacher ID is required", 400));
  }

  const teacher = await User.findById(teacherId);
  if (!teacher || teacher.role !== "teacher") {
    return next(new ApiError("Teacher not found", 404));
  }

  const filter = { teacher: teacherId };

  const reviewsCount = await Review.countDocuments(filter);

  const apiFeatures = new ApiFeatures(
    Review.find(filter)
      .populate("student", "firstName lastName email imageProfile")
      .populate("teacher", "firstName lastName"),
    req.query
  )
    .filter()
    // .search("reviewModel") // only if configured in ApiFeatures
    .sort()
    .limitFields()
    .paginate(reviewsCount);

  const { mongooseQuery, paginationResult } = apiFeatures;
  const reviews = await mongooseQuery;

  res.status(200).json({
    status: "success",
    results: reviews.length,
    pagination: paginationResult,
    data: reviews,
  });
});

// ===============================
// 📄 Get one review
// ===============================
exports.getReview = HandlerFactory.getOne(Review);

// ===============================
// 🗑️ Delete review
// ===============================
exports.deleteReview = asyncHandler(async (req, res, next) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return next(new ApiError("Review not found", 404));
  }

  const isOwner = review.student.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    return next(
      new ApiError("You are not allowed to delete this review", 403)
    );
  }

  // Optional: deduct points if owner deletes his review
  if (isOwner) {
    await deductPoints(req.user._id, 10); // same amount you added
  }

  const teacherId = review.teacher;

  await review.deleteOne();

  // Recalculate teacher rating
  if (teacherId) {
    await recalcTeacherRating(teacherId);
  }

  res.status(200).json({
    status: "success",
    message: "Review deleted successfully",
  });
});
