const express = require("express");
const {
  getMyPoints,
  getPointsLevelsStats,
  getAllUsersPointsAndLevels
} = require("../services/pointsService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const router = express.Router();

// ================= USER - GET MY POINTS =================
router.get(
  "/me",
  protect,
  getMyPoints
);
// ================= ADMIN - GET POINTS LEVELS STATS =================
router.get(
  "/levels-stats",
    protect, allowedTo("admin"),
  getPointsLevelsStats
);
// ================= ADMIN - GET ALL USERS POINTS AND LEVELS =================
router.get(
  "/all-users",
    protect, allowedTo("admin"),
  getAllUsersPointsAndLevels
);
module.exports = router;