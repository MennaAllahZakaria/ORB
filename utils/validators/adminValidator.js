const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.createAdminValidator = [
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
    check("phone")
        .optional()
        .isMobilePhone()
        .withMessage("Invalid phone number"),
    validatorMiddleware,
];

exports.idValidator = [
    check("id")
        .isMongoId()
        .withMessage("Invalid ID format"),
    validatorMiddleware,
];  
exports.updateAdminValidator = [
    check("id")
        .isMongoId()
        .withMessage("Invalid admin ID format"),
    check("firstName")
        .optional()
        .isLength({ min: 2 })
        .withMessage("First name must be at least 2 characters"),
    check("lastName")
        .optional()
        .isLength({ min: 2 })
        .withMessage("Last name must be at least 2 characters"),
    check("phone")
        .optional()
        .isMobilePhone()
        .withMessage("Invalid phone number"),
    validatorMiddleware,
];

exports.updateUserStatusValidator = [
    check("id")
        .isMongoId()
        .withMessage("Invalid user ID format"),
    check("status")
        .notEmpty()
        .isIn(["active", "inactive", "banned"])
        .withMessage("Status must be one of the following: active, inactive, banned"), 
    validatorMiddleware,    
];

