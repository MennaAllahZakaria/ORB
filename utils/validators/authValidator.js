const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.signupValidator = [
    check("firstName")
        .notEmpty()
        .withMessage("First name is required")
        .isLength({ min: 2 })
        .withMessage("First name must be at least 2 characters"),

    check("lastName")
        .notEmpty()
        .withMessage("Last name is required")
        .isLength({ min: 2 })
        .withMessage("Last name must be at least 2 characters"),

    check("email")
        .notEmpty()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Invalid email format"),

    check("password")
        .notEmpty()
        .withMessage("Password is required")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters"),
    
    check("confirmPassword")
        .notEmpty()
        .withMessage("Confirm Password is required")
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error("Password confirmation does not match password");
            }
            return true;
        }),

    check("role")
        .optional()
        .isIn(["student", "teacher", "admin"])
        .withMessage("Invalid role"),

    // 📌 only for teacher
    check("teacherProfile.subjects")
        .if(check("role").equals("teacher"))
        .notEmpty()
        .withMessage("Subjects are required for teacher"),
    // check("certificate")
    //     .if(check("role").equals("teacher"))
    //     .notEmpty()
    //     .withMessage("Certificate is required for teacher"),


    // 📌 only for student
    check("studentProfile.grade")
        .if(check("role").equals("student"))
        .notEmpty()
        .withMessage("Grade is required for student"),

    validatorMiddleware,
];


// 🔹 Login Validator
exports.loginValidator = [
    check("email")
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email address"),

    check("password")
        .notEmpty().withMessage("Password is required")
        .isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),

    validatorMiddleware,
];

// 🔹 Verify Email Validator
exports.verifyEmailValidator = [
    check("email")
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email"),

    check("code")
        .notEmpty().withMessage("Verification code is required")
        .isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits"),

    validatorMiddleware,
];

// 🔹 Forget Password Validator
exports.forgetPasswordValidator = [
    check("email")
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email"),

    validatorMiddleware,
];

// 🔹 Verify Password Reset Code Validator
exports.verifyResetCodeValidator = [
    check("email")
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email"),
    check("code")
        .notEmpty().withMessage("Reset code is required")
        .isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits"),

    validatorMiddleware,
];

// 🔹 Reset Password Validator
exports.resetPasswordValidator = [
    check("email")
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email"),

    check("newPassword")
        .notEmpty().withMessage("New password is required")
        .isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),

    check("passwordConfirm")
        .notEmpty().withMessage("Password confirmation is required")
        .custom((val, { req }) => {
        if (val !== req.body.newPassword) {
            throw new Error("Passwords do not match");
        }
        return true;
        }),

    validatorMiddleware,
];

// 🔹 Update Password Validator
exports.changePasswordValidator = [
    check("currentPassword")
        .notEmpty().withMessage("Current password is required"),
    check("newPassword")
        .notEmpty().withMessage("New password is required")
        .isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    check("passwordConfirm")
        .notEmpty().withMessage("Password confirmation is required")
        .custom((val, { req }) => {
        if (val !== req.body.newPassword) {
            throw new Error("Passwords do not match");
        }   
        return true;
        }),

    validatorMiddleware,
];
