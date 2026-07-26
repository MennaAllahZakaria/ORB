const rateLimit = require("express-rate-limit");

// Login
exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many login attempts. Please try again after 15 minutes.",
    },
});

// Signup
exports.signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many signup attempts. Please try again after 1 hour.",
    },
});

// Google Login
exports.googleLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many Google login attempts. Please try again later.",
    },
});

// Verify Email
exports.verifyEmailLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many verification attempts. Please wait 10 minutes.",
    },
});

// Forgot Password
exports.forgotPasswordLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many password reset requests. Please wait 10 minutes.",
    },
});

// Verify Reset Code
exports.verifyResetCodeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many reset code attempts. Please wait 10 minutes.",
    },
});

// Resend Verification Code
exports.resendCodeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many resend code requests. Please wait 10 minutes.",
    },
});