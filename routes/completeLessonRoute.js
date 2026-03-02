const express = require("express");
 
const {
    submitCompletion,
    getDisputedLessons,
    adminResolveLesson,
    getPastCompletedLessons,
    getProblematicPastLessons
} = require("../services/completeLessonService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {
    lessonIdValidator
} = require("../utils/validators/lessonValidator");

const {uploadImageAndFile, attachUploadedLinks} = require("../middleware/uploadFileMiddleware");

const router = express.Router();

router.use(protect);

router.post("/:lessonId",allowedTo("student" , "teacher"),lessonIdValidator,uploadImageAndFile, attachUploadedLinks,submitCompletion);

router.get("/disputedLessons", allowedTo("admin"),getDisputedLessons);

router.put("/:lessonId/adminResolve", allowedTo("admin"),lessonIdValidator,adminResolveLesson);

router.get("/pastCompletedLessons", allowedTo("student", "teacher"),getPastCompletedLessons);

router.get("/problematicPastLessons", allowedTo("student", "teacher"),getProblematicPastLessons);

module.exports = router;
