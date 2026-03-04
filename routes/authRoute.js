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
    updateImageProfile
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


const {uploadImageAndFile, attachUploadedLinks} = require("../middleware/uploadFileMiddleware");
const router = express.Router();

// ================= AUTH =================

// 📌 Signup (send verification email)
router.post("/signup" ,uploadImageAndFile,attachUploadedLinks, signupValidator, signup);

// 📌 Verify email (create account after code)
router.post("/verifyEmailUser", verifyEmailValidator, verifyEmailUser);

// 📌 Resend verification code
router.post("/resendVerificationCode", resendVerificationCode);

// 📌 Login
router.post("/login",loginValidator, login);

// ================= PASSWORD RESET =================

// 📌 Send reset code
router.post("/forgetPassword",forgetPasswordValidator, forgetPassword);

// 📌 Verify reset code
router.post("/verifyForgotPasswordCode",verifyResetCodeValidator, verifyForgotPasswordCode);

// 📌 Reset password
router.post("/resetPassword",resetPasswordValidator, resetPassword);
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
module.exports = router;
