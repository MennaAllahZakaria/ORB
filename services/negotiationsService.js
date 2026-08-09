const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Lesson = require("../models/lessonModel");
const Thread = require("../models/LessonNegotiationThreadModel");
const Message = require("../models/LessonNegotiationMessageModel");
const ApiError = require("../utils/apiError");

const { sendNegotiationNotification } =
  require("../services/negotiationNotificationService");

const { getIO } = require("../config/socket");

const { checkTeacherAvailability} = require("../utils/helpers");

const isSameId = (a, b) =>
  a && b && a.toString() === b.toString();

// =======================================================
//  update lesson price or teacher proposed price helper function
// =======================================================

async function updateLessonPriceOrProposedPrice(lesson, newPrice, userId, isTeacher) {

  if (isTeacher) {

    const interestedTeacher = lesson.interestedTeachers.find(t =>
      t.teacher.equals(userId)
    );

    if (!interestedTeacher)
      throw new ApiError("Teacher not interested", 403);

    interestedTeacher.proposedPrice = newPrice;

  } else {
    lesson.price = newPrice;
  }

  await lesson.save();
}



/* =========================================
   CREATE OR GET THREAD
========================================= */
exports.getOrCreateThread = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson)
    return next(new ApiError("Lesson not found", 404));

  if (lesson.status !== "pending" || lesson.paymentStatus !== "unpaid" ) {
  return next(
    new ApiError(
      "Negotiation is no longer available for this lesson",
      400
    )
  );
}

  let teacherId;

  if (req.user.role === "teacher") {
    const isInterested = lesson.interestedTeachers.some(t =>
      t.teacher.equals(req.user._id)
    );

    if (!isInterested)
      return next(new ApiError("Teacher not interested", 403));

    teacherId = req.user._id;
  }

  if (req.user.role === "student") {
    if (!lesson.student.equals(req.user._id))
      return next(new ApiError("Not lesson owner", 403));

    teacherId = req.query.teacherId;

    if (!teacherId)
      return next(new ApiError("teacherId required in query ", 400));
  }

  const thread = await Thread.findOneAndUpdate(
    {
      lesson: lessonId,
      teacher: teacherId,
      student: lesson.student
    },
    {
      $set: {
        lesson: lessonId,
        student: lesson.student,
        teacher: teacherId,
        status: "negotiating",
        agreedPrice: null,
        lastOfferMessage: null,
        lastOfferBy: null,
        lastOfferAt: null,
        offerExpiresAt: null
      }
    },
    {
      new: true,
      upsert: true
    }
  );

  res.json({ status: "success", data: thread });
});

/* =========================================
   GET THREADS FOR LESSON
========================================= */
exports.getThreadsForLesson = asyncHandler(async (req, res, next) => {
  const threads = await Thread.find({ lesson: req.params.lessonId })
      .populate("teacher", "firstName lastName email teacherProfile.avgRating imageProfile")
      .sort({ lastMessageAt: -1 });

    res.json({ status: "success", 
      results: threads.length,
      data: threads 
    });
});


/* =========================================
   SEND MESSAGE
========================================= */
exports.sendMessage = asyncHandler(async (req, res, next) => {

  const io = getIO();
  const { threadId } = req.params;
  const { price } = req.body;

  if (!price || price <= 0)
    return next(new ApiError("Invalid price", 400));

  /* =========================
     ATOMIC THREAD CHECK
  ========================== */

  const thread = await Thread.findOneAndUpdate(
    {
      _id: threadId,
      status: "negotiating",
      $or: [
        { student: req.user._id },
        { teacher: req.user._id }
      ]
    },
    {
      lastMessageAt: new Date(),
      lastOfferBy: req.user._id,
      lastOfferAt: new Date()
    },
    { new: true }
  ).populate("student teacher lesson");

  if (!thread)
    return next(new ApiError("Thread closed or not allowed", 400));

  /* =========================
     CREATE MESSAGE
  ========================== */

  const msg = await Message.create({
    thread: threadId,
    lesson: thread.lesson._id,
    sender: req.user._id,
    role: req.user.role,
    price,
    type: "offer"
  });

  await msg.populate("sender", "firstName lastName role imageProfile");

  /* =========================
     SAVE LAST OFFER MESSAGE
  ========================== */

  await Thread.findByIdAndUpdate(
    { _id: threadId },
    { lastOfferMessage: msg._id,
      offerExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
     }
  );

  /* =========================
     REALTIME MESSAGE
  ========================== */

  if (io) {
    io.to(threadId.toString()).emit("newMessage", msg);

    io.to(threadId.toString()).emit("negotiationStatus", {
      status: "waiting_for_approval",
      lastOfferBy: req.user._id
    });
  }

  /* =========================
     RESPONSE
  ========================== */

  res.status(201).json({
    status: "success",
    data: msg
  });

  /* =========================
     BACKGROUND NOTIFICATION
  ========================== */

  const receiver =
    thread.student.equals(req.user._id)
      ? thread.teacher
      : thread.student;

  setImmediate(() => {
    sendNegotiationNotification({
      lesson: thread.lesson,
      sender: req.user,
      receiver,
      price
    });
  });

  await updateLessonPriceOrProposedPrice(
    thread.lesson,
    price,
    req.user._id,
    req.user.role === "teacher"
  );
});


/* =========================================
   GET MESSAGES
========================================= */
exports.getMessages = asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  const page = +req.query.page || 0;

  const messages = await Message.find({ thread: threadId })
    .sort({ createdAt: 1 })
    .limit(30)
    .skip((page - 1) * 30)
    .populate("sender", "firstName lastName role imageProfile");

  res.json({
    status: "success",
    results: messages.length,
    data: messages
  });
});


/* =========================================
   ACCEPT OFFER
========================================= */
exports.acceptOffer = asyncHandler(async (req, res, next) => {

  const io = getIO();
  const { threadId, messageId } = req.params;

  const session = await mongoose.startSession();

  try {

    let acceptedData;

    await session.withTransaction(async () => {

      /* ======================================
         GET MESSAGE
      ====================================== */

      const message = await Message.findOne({
        _id: messageId,
        thread: threadId,
        type: "offer"
      }).session(session);

      if (!message) {
        throw new ApiError(
          "Invalid or unavailable offer",
          400
        );
      }

      /* ======================================
         CANNOT ACCEPT OWN OFFER
      ====================================== */

      if (
        message.sender &&
        message.sender.equals(req.user._id)
      ) {
        throw new ApiError(
          "You cannot accept your own offer",
          400
        );
      }

      /* ======================================
         GET THREAD
      ====================================== */

      const thread = await Thread.findOne({
        _id: threadId,
        status: "negotiating",
        lesson: { $exists: true },
        student: { $exists: true },
        teacher: { $exists: true }
      }).session(session);

      if (!thread) {
        throw new ApiError(
          "Negotiation thread is no longer active",
          400
        );
      }

      /* ======================================
         CHECK USER PARTICIPATION
      ====================================== */

      const isStudent =
        isSameId(thread.student, req.user._id);

      const isTeacher =
        isSameId(thread.teacher, req.user._id);

      if (!isStudent && !isTeacher) {
        throw new ApiError(
          "You are not allowed to accept this offer",
          403
        );
      }

      /* ======================================
         OFFER MUST BE FROM OTHER PARTY
      ====================================== */

      if (
        message.sender &&
        message.sender.equals(req.user._id)
      ) {
        throw new ApiError(
          "You cannot accept your own offer",
          400
        );
      }

      /* ======================================
         OFFER MUST BE THE LAST OFFER
      ====================================== */

      if (
        !thread.lastOfferMessage ||
        !thread.lastOfferMessage.equals(messageId)
      ) {
        throw new ApiError(
          "This offer is no longer the active offer",
          400
        );
      }

      /* ======================================
         CHECK OFFER EXPIRATION
      ====================================== */

      if (
        !thread.offerExpiresAt ||
        thread.offerExpiresAt.getTime() <= Date.now()
      ) {

        await Thread.updateOne(
          {
            _id: thread._id,
            status: "negotiating"
          },
          {
            $set: {
              status: "timeout"
            }
          },
          {
            session
          }
        );

        throw new ApiError(
          "Offer expired",
          400
        );
      }

      /* ======================================
         GET LESSON
      ====================================== */

      const lesson = await Lesson.findOne({
        _id: thread.lesson,
        status: "pending",
        acceptedTeacher: null
      }).session(session);

      if (!lesson) {
        throw new ApiError(
          "This lesson is no longer available for negotiation",
          400
        );
      }

      /* ======================================
         CHECK LESSON TIME
      ====================================== */
      const now = new Date();

      if (lesson.isUrgent) {
        const gracePeriod = 6 * 60 * 60 * 1000;

        if (
          new Date(lesson.requestedDate).getTime() +
            gracePeriod <=
          now.getTime()
        ) {
          throw new ApiError(
            "This urgent lesson request has expired.",
            400
          );
        }
      } else {
        if (
          new Date(lesson.requestedDate).getTime() <= now.getTime()
        ) {
          throw new ApiError(
            "Cannot accept an offer for a lesson whose scheduled time has passed.",
            400
          );
        }
      }

      /* ======================================
         CHECK TEACHER AVAILABILITY
      ====================================== */

      await checkTeacherAvailability(
        thread.teacher,
        lesson.requestedDate,
        lesson.durationInMinutes
      );

      /* ======================================
         ATOMIC ACCEPTANCE
      ====================================== */

      const updatedThread =
        await Thread.findOneAndUpdate(
          {
            _id: threadId,
            status: "negotiating",
            lastOfferMessage: messageId,
            offerExpiresAt: {
              $gt: new Date()
            },
            $or: [
              {
                student: req.user._id
              },
              {
                teacher: req.user._id
              }
            ]
          },
          {
            $set: {
              status: "accepted",
              agreedPrice: message.price
            }
          },
          {
            new: true,
            session
          }
        );

      if (!updatedThread) {
        throw new ApiError(
          "Offer can no longer be accepted. It may have expired or already been processed.",
          409
        );
      }

      /* ======================================
         UPDATE MESSAGE
      ====================================== */

      await Message.updateOne(
        {
          _id: messageId,
          thread: threadId,
          type: "offer"
        },
        {
          $set: {
            type: "accept"
          }
        },
        {
          session
        }
      );

      /* ======================================
         ATOMIC LESSON APPROVAL
      ====================================== */

      const updatedLesson =
        await Lesson.findOneAndUpdate(
          {
            _id: thread.lesson,
            status: "pending",
            acceptedTeacher: null,
            student: thread.student
          },
          {
            $set: {
              acceptedTeacher: thread.teacher,
              price: message.price,
              status: "approved"
            }
          },
          {
            new: true,
            session
          }
        );

      if (!updatedLesson) {

        throw new ApiError(
          "This lesson has already been assigned to another teacher",
          409
        );
      }

      /* ======================================
         CLOSE OTHER THREADS
      ====================================== */

      await Thread.updateMany(
        {
          lesson: updatedLesson._id,
          _id: {
            $ne: updatedThread._id
          },
          status: {
            $in: [
              "negotiating",
              "canceled",
              "timeout"
            ]
          }
        },
        {
          $set: {
            status: "closed"
          }
        },
        {
          session
        }
      );

      acceptedData = {
        lesson: updatedLesson,
        thread: updatedThread,
        price: message.price,
        teacher: thread.teacher,
        student: thread.student
      };

    });

    /* ======================================
       REALTIME
    ====================================== */

    if (io) {

      io.to(threadId.toString()).emit(
        "offerAccepted",
        {
          threadId,
          messageId,
          price: acceptedData.price,
          acceptedBy: req.user._id,
          teacher: acceptedData.teacher
        }
      );

      /*
        Notify the lesson room that the lesson
        is now approved.
      */

      io.to(
        `lesson_${acceptedData.lesson._id}`
      ).emit(
        "lessonApproved",
        {
          lessonId: acceptedData.lesson._id,
          teacherId: acceptedData.teacher,
          price: acceptedData.price
        }
      );

      /*
        Notify student directly if teacher
        accepted the student's offer.
      */

      io.to(
        `user_${acceptedData.student}`
      ).emit(
        "lessonApproved",
        {
          lessonId: acceptedData.lesson._id,
          teacherId: acceptedData.teacher,
          price: acceptedData.price
        }
      );

    }

    /* ======================================
       RESPONSE
    ====================================== */

    return res.status(200).json({
      status: "success",
      message: "Offer accepted successfully.",
      data: {
        price: acceptedData.price,
        teacher: acceptedData.teacher,
        lesson: acceptedData.lesson,
        threadId: acceptedData.thread._id
      }
    });

  } catch (err) {

    if (err instanceof ApiError) {
      return next(err);
    }

    console.error("acceptOffer error:", err);

    return next(
      new ApiError(
        "Failed to accept offer",
        500
      )
    );

  } finally {
    await session.endSession();
  }
});


/* =========================================
   REJECT OFFER
========================================= */
exports.rejectOffer = asyncHandler(async (req, res, next) => {
  const io = getIO();

  const { messageId } = req.params;

  const message = await Message.findById(messageId)
    .populate("thread");

  if (!message)
    return next(new ApiError("Message not found", 404));

  if (message.type !== "offer")
    return next(new ApiError("Only offers can be rejected", 400));

  const thread = message.thread;

  const isStudent = thread.student.equals(req.user._id);
  const isTeacher = thread.teacher.equals(req.user._id);

  if (!isStudent && !isTeacher)
    return next(new ApiError("Not allowed", 403));

  message.type = "reject";
  await message.save();

  // Close the thread as well
  thread.status = "closed";
  await thread.save();

  if (io){
    io.to(thread._id.toString()).emit("offerRejected", {
      messageId,
      threadId: thread._id
    });
    io.to(thread._id.toString()).emit("negotiationStatus", {
      status: "closed",
      messageId
    });
  }
  res.json({ status: "success", message: "Offer rejected and negotiation closed" });
});

exports.cancelNegotiation = asyncHandler(async (req, res, next) => {

  const io = getIO();

  const { threadId } = req.params;

  const thread = await Thread.findById(threadId);

  if (!thread) {
    return next(new ApiError("Thread not found", 404));
  }

  if (thread.status !== "negotiating") {
    return next(
      new ApiError("Negotiation already closed", 400)
    );
  }

  const isStudent = thread.student.equals(req.user._id);
  const isTeacher = thread.teacher.equals(req.user._id);

  if (!isStudent && !isTeacher) {
    return next(new ApiError("Not allowed", 403));
  }

  /* =========================
     GET LESSON
  ========================== */

  const lesson = await Lesson.findById(thread.lesson);

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  /* =========================
     CANCEL THREAD
  ========================== */

  thread.status = "canceled";

  thread.offerExpiresAt = null;
  thread.lastOfferMessage = null;
  thread.lastOfferAt = null;
  thread.lastOfferBy = null;

  await thread.save();

  /* =========================
     TEACHER CANCEL
  ========================== */

  if (isTeacher) {

    lesson.interestedTeachers =
      lesson.interestedTeachers.filter(
        item => !item.teacher.equals(req.user._id)
      );

    await lesson.save();
  }

  /* =========================
     SOCKET
  ========================== */

  if (io) {

    io.to(threadId.toString()).emit(
      "negotiationCanceled",
      {
        threadId,
        canceledBy: req.user._id
      }
    );

    io.to(threadId.toString()).emit(
      "negotiationStatus",
      {
        status: "canceled",
        threadId
      }
    );

  }

  res.status(200).json({
    status: "success",
    message: "Negotiation cancelled successfully",
    data: {
      threadId,
      status: thread.status
    }
  });

});