const express = require("express");

const {
    createLessonRequest,
    getLessonRequestsForTeacher,
    respondToLessonRequest,
    chooseTeacher,
    createMeeting,
    getInterestedTeachers,
    getLessons,
    getLessonDetailsForStudent,
    getLessonDetailsForTeacher,
    getUpcomingLessons,
    cancelLessonRequest,
    updateLessonRequest,
    
    
} = require("../services/lessonService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {
    createLessonValidator,
    respondToLessonRequestValidator,
    chooseTeacherValidator,
    lessonIdValidator
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

// ================= STUDENT OR TEACHER - CREATE MEETING FOR LESSON =================
router.post(
    "/:lessonId/create-meeting", allowedTo("student", "teacher"),
    lessonIdValidator,
    createMeeting
);

// ================= STUDENT - GET INTERESTED TEACHERS FOR LESSON =================
router.get(
    "/:lessonId/interested-teachers", allowedTo("student"),
    lessonIdValidator,
    getInterestedTeachers
);

// ================= STUDENT - GET LESSONS =================

router.get("/student/:lessonId", allowedTo("student"),lessonIdValidator, getLessonDetailsForStudent);

// ================= TEACHER - GET LESSONS =================
router.get("/teacher/:lessonId", allowedTo("teacher"),lessonIdValidator, getLessonDetailsForTeacher);

// ================= STUDENT/TEACHER - GET UPCOMING LESSONS =================
router.get("/upcoming-lessons", allowedTo("student", "teacher"), getUpcomingLessons);


// ================= USER - GET LESSONS =================
router.get("/", getLessons);

// ================= STUDENT - CANCEL LESSON REQUEST =================
router.delete(
    "/:lessonId/cancel", allowedTo("student" , "teacher" ),
    lessonIdValidator,
    cancelLessonRequest
);


// ================= STUDENT - UPDATE LESSON PRICE REQUEST =================
router.patch(
    "/:lessonId/update-lesson", allowedTo("student"),
    lessonIdValidator,
    
    updateLessonRequest
);

module.exports = router;
