const asyncHandler = require("express-async-handler");

const Lesson = require("../models/lessonModel");
const Thread = require("../models/LessonNegotiationThreadModel");
const Message = require("../models/LessonNegotiationMessageModel");
const ApiError = require("../utils/apiError");

const { sendNegotiationNotification } =
  require("../services/negotiationNotificationService");

const { getIO } = require("../config/socket");

// =======================================================
//  update lesson price or teacher porposed price helper function
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
      lesson: lessonId,
      student: lesson.student,
      teacher: teacherId
    },
    { new: true, upsert: true }
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

  await Thread.updateOne(
    { _id: threadId },
    { lastOfferMessage: msg._id }
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

  /* =========================
     GET MESSAGE + VALIDATION
  ========================== */

  const message = await Message.findOne({
    _id: messageId,
    thread: threadId
  });

  if (!message)
    return next(new ApiError("Invalid message", 400));

  if (message.type !== "offer")
    return next(new ApiError("Invalid offer", 400));

  if (message.sender.equals(req.user._id))
    return next(new ApiError("You cannot accept your own offer", 400));

  /* =========================
     ATOMIC THREAD UPDATE
  ========================== */

  const thread = await Thread.findOneAndUpdate(
    {
      _id: threadId,
      status: "negotiating",
      lastOfferMessage: messageId,
      $or: [
        { student: req.user._id },
        { teacher: req.user._id }
      ]
    },
    {
      status: "accepted",
      agreedPrice: message.price
    },
    { new: true }
  );

  if (!thread)
    return next(new ApiError("Offer cannot be accepted", 400));

  /* =========================
     UPDATE MESSAGE
  ========================== */

  message.type = "accept";
  await message.save();

  /* =========================
     UPDATE LESSON
  ========================== */

  const lesson = await Lesson.findByIdAndUpdate(
    thread.lesson,
    {
      acceptedTeacher: thread.teacher,
      price: message.price,
      status: "approved"
    },
    { new: true }
  );


  /* =========================
     CLOSE OTHER THREADS
  ========================== */

  await Thread.updateMany(
    { lesson: lesson._id, _id: { $ne: threadId } },
    { status: "closed" }
  );

  /* =========================
     REALTIME
  ========================== */

  if (io) {

    io.to(threadId).emit("offerAccepted", {
      price: message.price,
      acceptedBy: req.user._id
    });


  }

  res.status(200).json({
    status: "success",
    data: {
      price: message.price,
      teacher: thread.teacher,
    }
  });

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

exports.cancelNegotiation = asyncHandler(async (req,res,next)=>{

  const io = getIO();

  const {threadId} = req.params;

  const thread = await Thread.findById(threadId);

  if(!thread)
    return next(new ApiError("Thread not found",404));
  
  if (thread.status !== "negotiating")
    return next(new ApiError("Negotiation already closed", 400));

  const isStudent = thread.student.equals(req.user._id);
  const isTeacher = thread.teacher.equals(req.user._id);

  if(!isStudent && !isTeacher)
  return next(new ApiError("Not allowed",403));

  thread.status = "canceled";
  await thread.save();

  if(io){
    io.to(threadId).emit("negotiationCanceled",{
      threadId,
      canceledBy:req.user._id
    });
  }

  res.status(200).json({status:"success"});
});