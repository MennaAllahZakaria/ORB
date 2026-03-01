const express = require("express");

const {
  getOrCreateThread,
  getThreadsForLesson,
  sendMessage,
  getMessages,
  acceptOffer,
  rejectOffer
} = require("../services/negotiationsService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const router = express.Router();


/* =================================================
   ALL ROUTES REQUIRE AUTH
================================================= */
router.use(protect);


/* =================================================
   THREAD ROUTES
================================================= */

/*
 GET or CREATE thread
 teacher: /lessons/:lessonId/thread
 student: /lessons/:lessonId/thread?teacherId=xxx
*/
router.post(
  "/lessons/:lessonId/thread",
  getOrCreateThread
);

router.get(
  "/lessons/:lessonId/threads",
  allowedTo("student"),
  getThreadsForLesson
);


/* =================================================
   MESSAGE ROUTES
================================================= */

/* send offer / counter offer */
router.post(
  "/threads/:threadId/messages",
  sendMessage
);


/* get messages with pagination */
router.get(
  "/threads/:threadId/messages",
  getMessages
);


/* accept last offer */
router.patch(
  "/threads/:threadId/messages/:messageId/accept",
  acceptOffer
);


/* reject offer */
router.patch(
  "/messages/:messageId/reject",
  rejectOffer
);


module.exports = router;
