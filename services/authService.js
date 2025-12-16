const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");

const User = require("../models/userModel");
const Verification = require("../models/verificationModel");
const sendEmail = require("../utils/sendEmail");
const ApiError = require("../utils/apiError");
const createToken = require("../utils/createToken"); // JWT
const { encryptToken } = require("../utils/fcmToken");

// ==================== Helpers ====================

// Get bcrypt salt rounds from env or fallback
const getSaltRounds = () => {
  return parseInt(process.env.HASH_PASS, 10) || 12;
};

// Simple 6-digit verification code generator
const generateSixDigitCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Basic FCM token validation (not too strict)
function isValidFcmToken(token) {
  // Firebase tokens are long (+80 chars) and use these chars
  const fcmTokenRegex = /^[a-zA-Z0-9:_\-\.]{50,}$/;
  return fcmTokenRegex.test(token);
}

// ==================== SIGNUP ====================
// @route   POST /auth/signup
// @access  Public
exports.signup = asyncHandler(async (req, res, next) => {
  const { email, role, password } = req.body;

  if (!email || !password) {
    return next(new ApiError("Email and password are required", 400));
  }

  // Block direct admin signup
  if (role === "admin") {
    return next(new ApiError("You cannot register as admin", 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new ApiError("Email is already registered", 400));
  }

  // Prepare teacherProfile & imageProfile from upload middleware
  req.body.teacherProfile = req.body.teacherProfile || {};
  req.body.imageProfile = req.body.imageProfile || "";

  if (role === "teacher" && req.files?.certificate) {
    req.body.teacherProfile.certificate = req.certificateUrl;
  }

  if (req.files?.imageProfile) {
    req.body.imageProfile = req.imageProfileUrl;
  }

  // Remove any previous verification attempts for this email
  await Verification.deleteMany({ email, type: "emailVerification" });

  // Generate verification code
  const verificationCode = generateSixDigitCode();
  const expirationTime = Date.now() + 10 * 60 * 1000; // 10 minutes

  const hashedCode = await bcrypt.hash(verificationCode, 12);

  const message = `
                    Hi ${req.body.firstName || ""} ${req.body.lastName || ""},
                    Your verification code is:
                    ${verificationCode}
                    (valid for 10 minutes)
                    `;

  try {
    // Send verification email
    await sendEmail({
      Email: email,
      subject: "Email Verification Code",
      message,
    });

    // Prepare temp user data (without plain password)
    const { password, ...userData } = req.body;
    if (password) {
      const saltRounds = getSaltRounds();
      userData.password = await bcrypt.hash(password, saltRounds);
    }

    // Store verification with temp user data
    await Verification.create({
      email,
      code: hashedCode,
      expiresAt: new Date(expirationTime),
      type: "emailVerification",
      tempUserData: userData,
    });

    res.status(200).json({
      status: "success",
      message: "Verification code sent to your email.",
    });
  } catch (err) {
    console.error("Error sending signup verification email:", err.message);
    return next(new ApiError("Error sending email", 500));
  }
});

// ==================== VERIFY EMAIL ====================
// @route   POST /auth/verify-email
// @access  Public
exports.verifyEmailUser = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new ApiError("Email and code are required", 400));
  }

  const verification = await Verification.findOne({
    email,
    type: "emailVerification",
  });

  if (!verification) {
    return next(new ApiError("No verification request found", 400));
  }

  if (verification.expiresAt < Date.now()) {
    await Verification.deleteOne({ _id: verification._id });
    return next(new ApiError("Code expired", 400));
  }

  const isMatch = await bcrypt.compare(code, verification.code);
  if (!isMatch) {
    return next(new ApiError("Invalid code", 400));
  }

  // Create real user from tempUserData
  let user;
  try {
    user = await User.create(verification.tempUserData);
  } catch (err) {
    console.error("Error creating user during email verification:", err.message);
    // Clean up verification to avoid stuck records
    await Verification.deleteOne({ _id: verification._id });
    return next(
      new ApiError("Failed to create user. Please try signup again.", 500)
    );
  }

  // Delete verification after success
  await Verification.deleteOne({ _id: verification._id });

  // If teacher: do NOT login immediately, just mark as pending (schema default)
  if (user.role === "teacher") {
    // teacherProfile.verificationStatus should already be 'pending' by default

    // Try to notify teacher by email (do not fail flow if email sending fails)
    try {
      const message = `
            Hi ${user.firstName} ${user.lastName},
            Your account has been created and is pending approval. You will be notified once it is reviewed.
            `;
      await sendEmail({
        Email: user.email,
        subject: "Account Created - Pending Approval",
        message,
      });
    } catch (err) {
      console.error("Error sending teacher pending approval email:", err.message);
    }

    return res.status(201).json({
      status: "success",
      message: "Email verified successfully. Your account is pending approval.",
    });
  }

  // For students: login directly
  const token = createToken(user._id);

  res.status(201).json({
    status: "success",
    message: "Email verified successfully",
    token,
    user,
  });
});

// ==================== LOGIN ====================
// @route   POST /auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new ApiError("Email and password are required", 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new ApiError("Incorrect email or password", 401));
  }

  // Optional: block banned/inactive users
  if (user.status === "banned") {
    return next(new ApiError("Your account has been banned", 403));
  }
  if (user.status === "inactive") {
    return next(new ApiError("Your account is inactive", 403));
  }

  // Teacher must be approved
  if (user.role === "teacher") {
    const verificationStatus = user.teacherProfile?.verificationStatus;
    if (verificationStatus !== "approved") {
      return next(new ApiError("Your account is not approved yet", 403));
    }
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return next(new ApiError("Incorrect email or password", 401));
  }

  const token = createToken(user._id);

  res.status(200).json({
    status: "success",
    token,
    user,
  });
});

// ==================== FORGET PASSWORD ====================
// @route   POST /auth/forgot-password
// @access  Public
exports.forgetPassword = asyncHandler(async (req, res, next) => {
  const email = req.body.email;
  if (!email) {
    return next(new ApiError("Email is required", 400));
  }

  // Optional: check user existence but keep response generic
  const user = await User.findOne({ email });

  // Clear previous reset requests
  await Verification.deleteMany({ email, type: "passwordReset" });

  // If user doesn't exist, return generic success (avoid user enumeration)
  if (!user) {
    return res.status(200).json({
      status: "success",
      message: "Password reset code sent to your email.",
    });
  }

  const resetCode = generateSixDigitCode();
  const expirationTime = Date.now() + 10 * 60 * 1000;

  const hashedCode = await bcrypt.hash(resetCode, 12);

  const message = `
Your password reset code is:
${resetCode}
(valid for 10 minutes)
`;

  try {
    await sendEmail({
      Email: email,
      subject: "Password Reset Code",
      message,
    });

    await Verification.create({
      email,
      code: hashedCode,
      expiresAt: new Date(expirationTime),
      type: "passwordReset",
    });

    res.status(200).json({
      status: "success",
      message: "Password reset code sent to your email.",
    });
  } catch (err) {
    console.error("Error sending password reset email:", err.message);
    return next(new ApiError("Error sending email", 500));
  }
});

// ==================== VERIFY FORGOT PASSWORD CODE ====================
// @route   POST /auth/verify-reset-code
// @access  Public
exports.verifyForgotPasswordCode = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new ApiError("Email and code are required", 400));
  }

  const verification = await Verification.findOne({
    email,
    type: "passwordReset",
  });

  if (!verification) {
    return next(new ApiError("No reset request found", 400));
  }

  if (verification.expiresAt < Date.now()) {
    await Verification.deleteOne({ _id: verification._id });
    return next(new ApiError("Code expired", 400));
  }

  const isMatch = await bcrypt.compare(code, verification.code);
  if (!isMatch) {
    return next(new ApiError("Invalid reset code", 400));
  }

  verification.verified = true;
  await verification.save();

  res.status(200).json({
    status: "success",
    message: "Code verified successfully",
  });
});

// ==================== RESET PASSWORD ====================
// @route   POST /auth/reset-password
// @access  Public
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return next(new ApiError("Email and newPassword are required", 400));
  }

  if (newPassword.length < 8) {
    return next(new ApiError("Password must be at least 8 characters", 400));
  }

  const verification = await Verification.findOne({
    email,
    type: "passwordReset",
    verified: true,
  });

  if (!verification) {
    return next(new ApiError("No verified reset request found", 400));
  }

  if (verification.expiresAt < Date.now()) {
    await Verification.deleteOne({ _id: verification._id });
    return next(new ApiError("Reset request expired", 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const saltRounds = getSaltRounds();
  user.password = await bcrypt.hash(newPassword, saltRounds);
  user.passwordChangedAt = Date.now();
  await user.save();

  await Verification.deleteOne({ _id: verification._id });

  const token = createToken(user._id);

  res.status(200).json({
    status: "success",
    message: "Password reset successfully",
    token,
  });
});

// ==================== Change Password ====================
// @route   PUT /users/changePassword
// @access  Private (user)
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    return next(new ApiError("User not found", 404));
  }
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    return next(new ApiError("Current password is incorrect", 401));
  }
  const saltRounds = getSaltRounds();
  user.password = await bcrypt.hash(newPassword, saltRounds);
  user.passwordChangedAt = Date.now();
  await user.save();

    const message = `
      Your password has been changed successfully.
      If you did not perform this action, please contact support immediately.
      ORB Team
      `;
  try {
    await sendEmail({
      Email: user.email,
      subject: "Password Changed Successfully",
      message,
    });
  } catch (err) {
    console.error("Error sending password change notification email:", err.message);
  }


  res.status(200).json({
    status: "success",
    message: "Password changed successfully.",
  });
});

// ==================== UPDATE FCM TOKEN ====================
// @route   PUT /users/updateFcmToken
// @access  Private (user)
exports.updateFcmToken = asyncHandler(async (req, res, next) => {
  const { fcmToken } = req.body;

  if (!fcmToken || !isValidFcmToken(fcmToken)) {
    return next(new ApiError("FCM token is invalid", 400));
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { fcmToken: encryptToken(fcmToken) },
    { new: true }
  );

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  res.status(200).json({
    status: "success",
    message: "FCM Token updated successfully.",
  });
});
