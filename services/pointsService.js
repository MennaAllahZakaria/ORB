const User = require("../models/userModel");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

/**
 * 🪙 Add points to user
 * @param {string} userId
 * @param {number} points
 * @param {string} reason (optional)
 */
exports.addPoints = asyncHandler(async (userId, points, reason = "") => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  user.points += points;
  user.updateLevel();
  await user.save();

  console.log(`✅ Added ${points} points to ${user.first_name || user.email} (${reason})`);
  return user.points;
});

/**
 * 💸 Deduct points (e.g., when used for discount)
 */
exports.deductPoints = asyncHandler(async (userId, points) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  user.points = Math.max(0, user.points - points);
  user.updateLevel();
  await user.save();

  console.log(`⚠️ Deducted ${points} points from ${user.firstName || user.email}`);
  return user.points;
});

// ===============================
// 3️⃣ GET MY POINTS
// ===============================
exports.getMyPoints = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("points");
  res.status(200).json({
    status: "success",
    points: user.points,
  });
});

// ===============================
// 4️⃣ GET DASHBOARD POINTS LEVELS STATS
// ===============================
exports.getPointsLevelsStats = asyncHandler(async (req, res) => {
  const levels = ["Bronze", "Silver", "Gold", "Platinum"];
  const stats = {};
    for (const level of levels) {   
    const count = await User.countDocuments({ level });
    stats[level] = count;
  }
    res.status(200).json({
    status: "success",
    data: stats,
  });
});

// GET ALL USERS WITH THEIR POINTS AND LEVELS
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



