const bcrypt = require("bcrypt");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Verification = require("../models/verificationModel");
const sendEmail = require("../utils/sendEmail"); 
const ApiError = require("../utils/apiError");
const createToken = require("../utils/createToken"); // JWT

// ==================== SIGNUP ====================
exports.signup = asyncHandler(async (req, res, next) => {
    const email = req.body.Email.toLowerCase();

    // لو فيه كود قديم لنفس الإيميل → نحذفه
    await Verification.deleteMany({ email, type: "emailVerification" });

    // كود 6 أرقام
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = Date.now() + 10 * 60 * 1000;

    const hashedCode = await bcrypt.hash(verificationCode, 12);

    // تجهيز الرسالة
    const message = `
    Hi ${req.body.firstName} ${req.body.lastName},
    Your verification code is:
    ${verificationCode}
    (valid for 10 minutes)
    `;

    // إرسال الإيميل
    try {
        await sendEmail({
        Email: email,
        subject: "Email Verification Code",
        message,
        });

        const { password, ...userData } = req.body;
        if (password) {
        const saltRounds = parseInt(process.env.HASH_PASS, 10) || 12;
        userData.password = await bcrypt.hash(password, saltRounds);
        }

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
        return next(new ApiError("Error sending email", 500));
    }
});

// ==================== VERIFY EMAIL ====================
exports.verifyEmailUser = asyncHandler(async (req, res, next) => {
    const { email, code } = req.body;

    const verification = await Verification.findOne({ email, type: "emailVerification" });
    if (!verification) return next(new ApiError("No verification request found", 400));

    if (verification.expiresAt < Date.now()) {
        await Verification.deleteOne({ _id: verification._id });
        return next(new ApiError("Code expired", 400));
    }

    const isMatch = await bcrypt.compare(code, verification.code);
    if (!isMatch) return next(new ApiError("Invalid code", 400));

    // إنشاء اليوزر الحقيقي
    const user = await User.create(verification.tempUserData);

    await Verification.deleteOne({ _id: verification._id });

    const token = createToken(user._id);

    res.status(201).json({
        status: "success",
        message: "Email verified successfully",
        token,
        user,
    });
});

// ==================== LOGIN ====================
exports.login = asyncHandler(async (req, res, next) => {
    const { Email, password } = req.body;
    const user = await User.findOne({ Email });
    if (!user) return next(new ApiError("Incorrect email or password", 401));

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return next(new ApiError("Incorrect email or password", 401));

    const token = createToken(user._id);

    res.status(200).json({
        status: "success",
        token,
        user,
    });
});

// ==================== FORGET PASSWORD ====================
exports.forgetPassword = asyncHandler(async (req, res, next) => {
    const email = req.body.Email.toLowerCase();

    // clear any previous reset requests
    await Verification.deleteMany({ email, type: "passwordReset" });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = Date.now() + 10 * 60 * 1000;

    // Hash the code
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
        return next(new ApiError("Error sending email", 500));
    }
});

// ==================== VERIFY FROGOT PASSWORD CODE ====================

exports.verifyForgotPasswordCode = asyncHandler(async (req, res, next) => {
    const { email, code } = req.body;

    const verification = await Verification.findOne({ email, type: "passwordReset" });
    if (!verification) return next(new ApiError("No reset request found", 400));

    if (verification.expiresAt < Date.now()) {
        await Verification.deleteOne({ _id: verification._id });
        return next(new ApiError("Code expired", 400));
    }

    const isMatch = await bcrypt.compare(code, verification.code);
    if (!isMatch) return next(new ApiError("Invalid reset code", 400));

    // Mark as verified (لو عايزة تخليها مرحلة وسيطة قبل reset)
    verification.verified = true;
    await verification.save();

    res.status(200).json({
        status: "success",
        message: "Code verified successfully",
    });
});


// ==================== RESET PASSWORD ====================
exports.resetPassword = asyncHandler(async (req, res, next) => {
    const { email, code, newPassword } = req.body;

    const verification = await Verification.findOne({ email, type: "passwordReset" });
    if (!verification) return next(new ApiError("No reset request found", 400));

    if (verification.expiresAt < Date.now()) {
        await Verification.deleteOne({ _id: verification._id });
        return next(new ApiError("Code expired", 400));
    }

    const isMatch = await bcrypt.compare(code, verification.code);
    if (!isMatch) return next(new ApiError("Invalid reset code", 400));

    const user = await User.findOne({ Email: email });
    if (!user) return next(new ApiError("User not found", 404));

    user.password = await bcrypt.hash(newPassword, 12);
    user.passwordChangeAt = Date.now();
    await user.save();

    // Delete verification record after success
    await Verification.deleteOne({ _id: verification._id });

    const token = createToken(user._id);

    res.status(200).json({
        status: "success",
        message: "Password reset successfully",
        token,
    });
});

