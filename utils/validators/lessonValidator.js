const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.createLessonValidator = [
    check("title")
        .notEmpty()
        .withMessage("title required")
        .isString()
        .withMessage("title must be a string"),
    check("subject")
        .notEmpty() 
        .withMessage("subject required")
        .isString()
        .withMessage("subject must be a string"),
    check("price")  
        .notEmpty()
        .withMessage("price required")
        .isFloat({ gt: 0 })
        .withMessage("price must be a positive number"),
    check("requestedDate")
        .notEmpty()
        .withMessage("requestedDate required")
        .isISO8601()
        .withMessage("Invalid date format"),
    check("durationInMinutes")
        .notEmpty()
        .withMessage("durationInMinutes required")
        .isInt({ gt: 0 })
        .withMessage("durationInMinutes must be a positive integer"),
    validatorMiddleware,
];

exports.counterOfferFromTeacherValidator = [
    check("lessonId")
        .notEmpty()
        .withMessage("lessonId required")
        .isMongoId()
        .withMessage("Invalid lessonId format"),
    check("proposedPrice")
        .notEmpty()
        .withMessage("proposedPrice required")
        .isFloat({ gt: 0 })
        .withMessage("proposedPrice must be a positive number"),
    check("message")
        .optional()
        .isString()
        .withMessage("message must be a string"),
    validatorMiddleware,
];


exports.respondToLessonRequestValidator = [
    check("lessonId")
        .notEmpty()
        .withMessage("lessonId required")
        .isMongoId()
        .withMessage("Invalid lessonId format"),
    check("response")
        .notEmpty()
        .withMessage("response required")
        .isIn(["accept", "reject"])
        .withMessage("response must be either 'interested' or 'not_interested'"),
    validatorMiddleware,
];

exports.chooseTeacherValidator = [
    check("lessonId")
        .notEmpty()
        .withMessage("lessonId required")
        .isMongoId()
        .withMessage("Invalid lessonId format"),
    check("teacherId")
        .notEmpty()
        .withMessage("teacherId required")
        .isMongoId()
        .withMessage("Invalid teacherId format"),
    validatorMiddleware,
];

exports.lessonIdValidator = [
    check("lessonId")
        .notEmpty()
        .withMessage("lessonId required")
        .isMongoId()
        .withMessage("Invalid lessonId format"),
    validatorMiddleware,
];