const express = require("express");

const {
  createReview,
  getAllReviews,
  getAllReviewsForTeacher,
  getReview,
  deleteReview,
} = require("../services/reviewService");

const { protect, allowedTo } = require("../middleware/authMiddleware");
const router = express.Router();
// ================= USER - CREATE REVIEW =================
router.post("/", protect, allowedTo("student"), createReview);
// ================= ALL USERS - GET ALL REVIEWS =================
router.get("/", protect, getAllReviews);
// ================= ALL USERS - GET ALL REVIEWS FOR A TEACHER =================
router.get("/teacher/:teacherId", protect, getAllReviewsForTeacher);
// ================= ALL USERS - GET A REVIEW =================
router.get("/:id", protect, getReview);
// ================= USER - DELETE REVIEW =================
router.delete("/:id", protect, allowedTo("student"), deleteReview);
module.exports = router;