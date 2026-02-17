const express = require("express");

const {
  getOrCreateThread,
  sendMessage,
  getMessages,
  acceptOffer,
  rejectOffer
} = require("../services/negotiationNotificationService");

const { protect } = require("../middleware/authMiddleware");

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


/*
 OPTIONAL
 list all threads for lesson (for student dashboard)
*/
router.get(
  "/lessons/:lessonId/threads",
  async (req, res) => {
    const Thread = require("../models/LessonNegotiationThreadModel");

    const threads = await Thread.find({ lesson: req.params.lessonId })
      .populate("teacher", "firstName lastName")
      .sort({ lastMessageAt: -1 });

    res.json({ status: "success", data: threads });
  }
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
