const express = require("express");
 
const {
    submitCompletion,
    getDisputedLessons,
    adminResolveLesson,
    getPastCompletedLessons,
    getProblematicPastLessons, 
    getExpiredLessons
} = require("../services/completeLessonService");

const { protect, allowedTo } = require("../middleware/authMiddleware");
const { auditOnSuccess } = require("../middleware/auditMiddleware");

const {
    lessonIdValidator
} = require("../utils/validators/lessonValidator");

const {uploadImageAndFile, attachUploadedLinks} = require("../middleware/uploadFileMiddleware");

const router = express.Router();

router.use(protect);

router.post("/:lessonId",allowedTo("student" , "teacher"),lessonIdValidator,uploadImageAndFile, attachUploadedLinks,submitCompletion);

router.get("/disputedLessons", allowedTo("admin"),getDisputedLessons);

router.put("/:lessonId/adminResolve", allowedTo("admin"),lessonIdValidator,auditOnSuccess({ action: "lesson.admin_resolved", entityType: "Lesson" }),adminResolveLesson);

router.get("/pastCompletedLessons", allowedTo("student", "teacher"),getPastCompletedLessons);

router.get("/problematicPastLessons", allowedTo("student", "teacher"),getProblematicPastLessons);

router.get("/expiredLessons", allowedTo("student", "teacher"),getExpiredLessons);

module.exports = router;
