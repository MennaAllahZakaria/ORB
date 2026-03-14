const express = require("express");

const {
  getOrCreateThread,
  getThreadsForLesson,
  sendMessage,
  getMessages,
  acceptOffer,
  rejectOffer,
  cancelNegotiation
} = require("../services/negotiationsService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const {lessonIdValidator} = require("../utils/validators/lessonValidator");
const {sendMessageValidator, acceptOfferValidator, rejectOfferValidator, threadIdValidator} = require("../utils/validators/negotiationValidator");

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
  lessonIdValidator,
  getOrCreateThread
);

router.get(
  "/lessons/:lessonId/threads",
  allowedTo("student"),
  lessonIdValidator,
  getThreadsForLesson
);


/* =================================================
   MESSAGE ROUTES
================================================= */

/* send offer / counter offer */
router.post(
  "/threads/:threadId/messages",
  sendMessageValidator,
  sendMessage
);


/* get messages with pagination */
router.get(
  "/threads/:threadId/messages",
  threadIdValidator,
  getMessages
);


/* accept last offer */
router.patch(
  "/threads/:threadId/messages/:messageId/accept",
  acceptOfferValidator,
  acceptOffer
);


/* reject offer */
router.patch(
  "/messages/:messageId/reject",
  rejectOfferValidator,
  rejectOffer
);

/* cancel negotiation */
router.patch(
  "/threads/:threadId/cancel",
  threadIdValidator,
  cancelNegotiation
);

module.exports = router;
