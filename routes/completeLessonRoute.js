const express = require("express");
 
const {
    submitCompletion,
    getDisputedLessons,
    adminResolveLesson
} = require("../services/completeLessonService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {
    lessonIdValidator
} = require("../utils/validators/lessonValidator");

const router = express.Router();

router.use(protect);

router.post("/:lessonId",allowedTo("student" , "teacher"),lessonIdValidator,submitCompletion);

router.get("/disputedLessons", allowedTo("admin"),getDisputedLessons);

router.put("/:lessonId/adminResolve", allowedTo("admin"),lessonIdValidator,adminResolveLesson);

module.exports = router;
