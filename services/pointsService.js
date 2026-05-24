const User = require("../models/userModel");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const { sendNotification } = require("../utils/notificationHelper");

/**
 * Helper: validate points value
 */
function assertValidPoints(points) {
  if (!Number.isFinite(points) || points <= 0) {
    throw new ApiError("Points must be a positive number", 400);
  }
}

/**
 * 🪙 Add points to user (service function)
 * - NOT an Express handler, so no asyncHandler here.
 * - To be used from controllers: await addPoints(userId, points, reason)
 *
 * @param {string} userId
 * @param {number} points
 * @param {string} reason (optional, used only for logging / audit)
 */
exports.addPoints = async (userId, points, reason = "") => {
  assertValidPoints(points);

  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  // Ensure points field is numeric
  user.points = (user.points || 0) + points;

  // Update level based on new points
  user.updateLevel();
  await user.save();

  // Notify User about points added
  setImmediate(() => {
    sendNotification({
      recipient: user,
      titleEn: "🎉 Points Earned!",
      titleAr: "🎉 حصلت على نقاط جديدة!",
      bodyEn: `You have earned ${points} points for: ${reason}.`,
      bodyAr: `لقد حصلت على ${points} نقطة بسبب: ${reason}.`,
      data: { type: "points_added" }
    });
  });

  console.log(
    `✅ Added ${points} points to ${user.firstName || user.email} (${reason})`
  );

  return user.points;
};

/**
 * 💸 Deduct points from user (service function)
 * - Clamped to 0 (no negative balances).
 *
 * @param {string} userId
 * @param {number} points
 */
exports.deductPoints = async (userId, points) => {
  assertValidPoints(points);

  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  const newPoints = Math.max(0, (user.points || 0) - points);
  user.points = newPoints;

  user.updateLevel();
  await user.save();

  console.log(
    `⚠️ Deducted ${points} points from ${user.firstName || user.email}`
  );

  return user.points;
};

/**
 * ===============================
 * 3️⃣ GET MY POINTS
 * ===============================
 * @route   GET /users/me/points
 * @access  Private (logged-in user)
 */
exports.getMyPoints = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).select("points level");
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  res.status(200).json({
    status: "success",
    points: user.points,
    level: user.level,
  });
});

/**
 * ===============================
 * 4️⃣ GET DASHBOARD POINTS LEVELS STATS
 * ===============================
 * @route   GET /admin/points/levels-stats
 * @access  Private (admin)
 */
exports.getPointsLevelsStats = asyncHandler(async (req, res) => {
  const levels = ["Bronze", "Silver", "Gold", "Platinum"];
  const stats = {};

  // Run counts in parallel for better performance
  const counts = await Promise.all(
    levels.map((level) => User.countDocuments({ level }))
  );

  levels.forEach((level, idx) => {
    stats[level] = counts[idx];
  });

  res.status(200).json({
    status: "success",
    data: stats,
  });
});

/**
 * GET ALL USERS WITH THEIR POINTS AND LEVELS
 * @route   GET /admin/points/users
 * @access  Private (admin)
 */
exports.getAllUsersPointsAndLevels = asyncHandler(async (req, res) => {
  const users = await User.find()
    .select("firstName lastName email points level")
    .sort({ points: -1 });

  res.status(200).json({
    status: "success",
    results: users.length,
    data: users,
  });
});
