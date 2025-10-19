const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.updatePaymentInfoValidator = [
    check("method")
        .notEmpty()
        .withMessage("Payment method is required")
        .isIn(["bank", "wallet"])
        .withMessage("Payment method must be either 'bank' or 'wallet'"),
    check("accountName")
        .optional()
        .isString()
        .withMessage("Account name must be a string"),
    check("accountNumber")
        .optional()
        .isString()
        .withMessage("Account number must be a string"),
    check("bankName")
        .optional()
        .isString()
        .withMessage("Bank name must be a string"),
    check("walletProvider")
        .optional()
        .isString()
        .withMessage("Wallet provider must be a string"),
    check("phoneNumber")
        .optional()
        .isString()
        .withMessage("Phone number must be a string"),
    validatorMiddleware,
];