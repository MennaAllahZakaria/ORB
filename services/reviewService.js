const asyncHandler = require("express-async-handler");
const HandlerFactory = require("./handlerFactory");
const Review = require("../models/reviewModel");
const Lesson = require("../models/lessonModel");
const User = require("../models/userModel");
const {addPoints , deductPoints} = require("./pointsService");
const ApiFeatures = require("../utils/apiFeatures");
const ApiError = require("../utils/apiError");


// 🎯 add new review
exports.createReview = asyncHandler(async (req, res) => {
  const { lessonId, rating, comment } = req.body;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) {
    res.status(404);
    throw new Error("Lesson not found");
  }

  //  the student can only review their own lessons
  if (lesson.student.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("You can only review your own lessons");
  }

  // lesson must be completed to allow review
  if (lesson.status !== "completed") {
    res.status(400);
    throw new Error("You can only review after lesson completion");
  }

  //one review per lesson
  const existing = await Review.findOne({ lesson: lessonId });
  if (existing) {
    res.status(400);
    throw new Error("Review already exists for this lesson");
  }

  // create review
  const review = await Review.create({
    lesson: lessonId,
    student: req.user._id,
    teacher: lesson.acceptedTeacher,
    rating,
    comment,
  });

//add points to student for writing review
  await addPoints(req.user._id, 10, "Review submitted");

  res.status(201).json({
    status: "success",
    data: review,
  });
});

// 📋 get all reviews
exports.getAllReviews = HandlerFactory.getAll(Review);

// 📋 get all reviews for teacher


exports.getAllReviewsForTeacher = asyncHandler(async (req, res, next) => {
  const { teacherId } = req.params;

  // ✅validation for teacher ID
  if (!teacherId) {
    return next(new ApiError("Teacher ID is required", 400));
  }

  // ✅ filter reviews by teacher
  const filter = { teacher: teacherId };

  // 📊 calc total reviews
  const reviewsCount = await Review.countDocuments(filter);

  // ⚙️  ApiFeatures (filter , search ,  pagination)
  const apiFeatures = new ApiFeatures(
    Review.find(filter)
      .populate("student", "firstName lastName email") // جلب بيانات الطالب
      .populate("teacher", "firstName lastName"), // ممكن تضيفها لو محتاج
    req.query
  )
    .filter()
    .search("reviewModel")
    .sort()
    .limitFields()
    .paginate(reviewsCount);

  const { mongooseQuery, paginationResult } = apiFeatures;
  const reviews = await mongooseQuery;

  // 📤 الإرسال
  res.status(200).json({
    status: "success",
    results: reviews.length,
    pagination: paginationResult,
    data: reviews,
  });
});

// 📄 get aon review
exports.getReview = HandlerFactory.getOne(Review);

// 🗑️ delete review
exports.deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }

  // تأكد إن الطالب هو اللي حذف ريفيوه
  if (review.student.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("You can only delete your own reviews");
  }

  await review.findByIdAndDelete(req.params.id);
  res.status(200).json({ message: "Review deleted successfully" });
});
