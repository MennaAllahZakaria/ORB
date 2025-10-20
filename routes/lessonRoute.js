const express = require("express");

const {
    createLessonRequest,
    getLessonRequestsForTeacher,
    respondToLessonRequest,
    chooseTeacher,
    getInterestedTeachers,
    getLessons,
    cancelLessonRequest,
    completeLesson
    
} = require("../services/lessonService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {
    createLessonValidator,
    respondToLessonRequestValidator,
    chooseTeacherValidator,
    getInterestedTeachersValidator
} = require("../utils/validators/lessonValidator");

const router = express.Router();

router.use(protect);

// ================= STUDENT - CREATE LESSON REQUEST =================
router.post("/", allowedTo("student"), createLessonValidator, createLessonRequest);

// ================= TEACHER - GET LESSON REQUESTS =================
router.get("/requests", allowedTo("teacher"), getLessonRequestsForTeacher); 

// ================= TEACHER - RESPOND TO LESSON REQUEST =================
router.post(
    "/requests/:lessonId/respond", allowedTo("teacher"),
    respondToLessonRequestValidator,
    respondToLessonRequest
);

// ================= STUDENT - CHOOSE TEACHER FOR LESSON =================
router.post(
    "/:lessonId/choose-teacher/:teacherId", allowedTo("student"),
    chooseTeacherValidator,
    chooseTeacher
);

// ================= STUDENT - GET INTERESTED TEACHERS FOR LESSON =================
router.get(
    "/:lessonId/interested-teachers", allowedTo("student"),
    getInterestedTeachersValidator,
    getInterestedTeachers
);

// ================= USER - GET LESSONS =================
router.get("/", getLessons);

// ================= STUDENT - CANCEL LESSON REQUEST =================
router.delete(
    "/:lessonId/cancel", allowedTo("student"),
    cancelLessonRequest
);

// ================= STUDENT - COMPLETE LESSON =================
router.patch(
    "/:lessonId/complete", allowedTo("teacher"),
    completeLesson
);
module.exports = router;