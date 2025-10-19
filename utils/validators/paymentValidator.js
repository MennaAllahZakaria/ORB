const { check } = require("express-validator");
const validatorMiddleware = require("../../middleware/validatorMiddleware");

exports.idValidator = [
    check("lessonId")
        .notEmpty()
        .withMessage("lessonId required")
        .isMongoId()
        .withMessage("Invalid lessonId format"),
    validatorMiddleware,
];