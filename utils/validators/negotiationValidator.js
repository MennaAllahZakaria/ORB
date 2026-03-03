const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.sendMessageValidator = [
  check("threadId")
    .notEmpty()
    .withMessage("threadId required")
    .isMongoId()
    .withMessage("Invalid threadId format"),

  check("message")
    .optional()
    .isLength({ max: 500 })
    .withMessage("message can be at most 500 characters"),
  check("price")
    .optional()
    .isFloat({ gt: 0 })
    .withMessage("price must be a positive number"),
  validatorMiddleware,
];

exports.acceptOfferValidator = [
  check("threadId")
    .notEmpty()
    .withMessage("threadId required")
    .isMongoId()
    .withMessage("Invalid threadId format"),
  check("messageId")
    .notEmpty()
    .withMessage("messageId required")
    .isMongoId()
    .withMessage("Invalid messageId format"),
  validatorMiddleware,
];
    
exports.rejectOfferValidator = [
  check("messageId")
    .notEmpty()
    .withMessage("messageId required")
    .isMongoId()
    .withMessage("Invalid messageId format"),
  validatorMiddleware,
];

exports.threadIdValidator = [
  check("threadId")
    .notEmpty()
    .withMessage("threadId required")
    .isMongoId()
    .withMessage("Invalid threadId format"),
  validatorMiddleware,
];