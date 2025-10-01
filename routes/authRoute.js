const express = require("express");
const {
    signup,
    verifyEmailUser,
    login,
    forgetPassword,
    verifyForgotPasswordCode,
    resetPassword,
} = require("../services/authService");

const {
    signupValidator,
    loginValidator,
    verifyEmailValidator,
    forgetPasswordValidator,
    verifyResetCodeValidator,
    resetPasswordValidator,
} = require("../utils/validators/authValidator");

const router = express.Router();

// ================= AUTH =================

// 📌 Signup (send verification email)
router.post("/signup", signupValidator, signup);

// 📌 Verify email (create account after code)
router.post("/verifyEmailUser", verifyEmailValidator, verifyEmailUser);

// 📌 Login
router.post("/login",loginValidator, login);

// ================= PASSWORD RESET =================

// 📌 Send reset code
router.post("/forgetPassword",forgetPasswordValidator, forgetPassword);

// 📌 Verify reset code
router.post("/verifyForgotPasswordCode",verifyEmailValidator, verifyForgotPasswordCode);

// 📌 Reset password
router.post("/resetPassword",resetPasswordValidator, resetPassword);

module.exports = router;
