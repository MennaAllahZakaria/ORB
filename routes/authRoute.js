const express = require("express");
const {
    signup,
    verifyEmailUser,
    resendVerificationCode,
    login,
    forgetPassword,
    verifyForgotPasswordCode,
    resetPassword,
    updateFcmToken,
    changePassword,
    updatePreferredLanguage,
    getLoggedInUser,
    updateImageProfile,
    updateProfile,
    googleLogin,
    completeProfile,
    setPassword
} = require("../services/authService");

const {
    signupValidator,
    loginValidator,
    verifyEmailValidator,
    forgetPasswordValidator,
    verifyResetCodeValidator,
    resetPasswordValidator,
    changePasswordValidator
} = require("../utils/validators/authValidator");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {
    loginLimiter,
    signupLimiter,
    googleLoginLimiter,
    verifyEmailLimiter,
    forgotPasswordLimiter,
    verifyResetCodeLimiter,
    resendCodeLimiter,
} = require("../middleware/rateLimit");

const {uploadImageAndFile, attachUploadedLinks} = require("../middleware/uploadFileMiddleware");
const router = express.Router();

// ================= AUTH =================

// 📌 Signup (send verification email)
router.post("/signup" ,signupLimiter, uploadImageAndFile,attachUploadedLinks, signupValidator, signup);

// 📌 Verify email (create account after code)
router.post("/verifyEmailUser", verifyEmailLimiter, verifyEmailValidator, verifyEmailUser);

// 📌 Resend verification code
router.post("/resendVerificationCode", resendCodeLimiter, resendVerificationCode);

// 📌 Login
router.post("/login", loginLimiter, loginValidator, login);

// ================= PASSWORD RESET =================

// 📌 Send reset code
router.post("/forgetPassword", forgotPasswordLimiter, forgetPasswordValidator, forgetPassword);

// 📌 Verify reset code
router.post("/verifyForgotPasswordCode", verifyResetCodeLimiter, verifyResetCodeValidator, verifyForgotPasswordCode);

// 📌 Reset password
router.post("/resetPassword", forgotPasswordLimiter, resetPasswordValidator, resetPassword);
// ================= UPDATE FCM TOKEN =================

router.post("/updateFcmToken",protect, updateFcmToken);

// ================= CHANGE PASSWORD =================
router.put("/changePassword",protect, changePasswordValidator, changePassword);

// ================= UPDATE PREFERRED LANGUAGE =================
router.patch("/updatePreferredLanguage",protect, updatePreferredLanguage);

//================== GET LOGGED IN USER DATA ===================
router.get("/me",protect,getLoggedInUser);

//================== UPDATE IMAGE PROFILE ===================
router.patch("/updateImageProfile", protect, uploadImageAndFile, attachUploadedLinks, updateImageProfile);

//================== UPDATE PROFILE ===================
router.patch("/updateProfile", protect,  updateProfile);

//================== GOOGLE AUTH ===================
router.post("/google-login", googleLogin);
router.post("/complete-profile", protect, completeProfile);
router.put("/set-password", protect, setPassword);

module.exports = router;
