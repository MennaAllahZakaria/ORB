const asyncHandler = require("express-async-handler");

const Lesson = require("../models/lessonModel");
const Thread = require("../models/LessonNegotiationThreadModel");
const Message = require("../models/LessonNegotiationMessageModel");
const ApiError = require("../utils/apiError");

const { sendNegotiationNotification } =
  require("./negotiationNotificationService");

const { getIO } = require("../config/socket"); // 🔥 مهم


exports.getOrCreateThread = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  let teacherId;

  if (req.user.role === "teacher") {
    const isInterested = lesson.interestedTeachers.some(t =>
      t.equals(req.user._id)
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
      return next(new ApiError("teacherId required", 400));
  }

  const thread = await Thread.findOneAndUpdate(
    { lesson: lessonId, teacher: teacherId },
    {
      lesson: lessonId,
      student: lesson.student,
      teacher: teacherId
    },
    { new: true, upsert: true }
  );

  res.json({ status: "success", data: thread });
});


exports.sendMessage = asyncHandler(async (req, res, next) => {
  const io = getIO();

  const { threadId } = req.params;
  const { price, message } = req.body;

  if (!price || price <= 0)
    return next(new ApiError("Invalid price", 400));

  const thread = await Thread.findById(threadId)
    .populate("student teacher lesson");

  if (!thread) return next(new ApiError("Thread not found", 404));
  if (thread.status !== "negotiating")
    return next(new ApiError("Thread closed", 400));

  const isStudent = thread.student._id.equals(req.user._id);
  const isTeacher = thread.teacher._id.equals(req.user._id);

  if (!isStudent && !isTeacher)
    return next(new ApiError("Not allowed", 403));

  const msg = await Message.create({
    thread: threadId,
    lesson: thread.lesson._id,
    sender: req.user._id,
    role: req.user.role,
    price,
    message,
    type: "offer"
  });

  await msg.populate("sender", "firstName lastName role");

  thread.lastMessageAt = new Date();
  await thread.save();

  const receiver = isStudent ? thread.teacher : thread.student;

  // 🔔 push
  await sendNegotiationNotification({
    lesson: thread.lesson,
    sender: req.user,
    receiver,
    price
  });

  // ⚡ realtime
  io.to(threadId.toString()).emit("newMessage", msg);

  res.status(201).json({
    status: "success",
    data: msg
  });
});

exports.getMessages = asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  const page = +req.query.page || 0;

  const messages = await Message.find({ thread: threadId })
    .sort({ createdAt: 1 })
    .limit(30)
    .skip(page * 30)
    .populate("sender", "firstName lastName role");

  res.json({
    status: "success",
    results: messages.length,
    data: messages
  });
});

exports.acceptOffer = asyncHandler(async (req, res, next) => {
  const io = getIO();

  const { threadId, messageId } = req.params;

  const thread = await Thread.findById(threadId);
  if (!thread) return next(new ApiError("Thread not found", 404));

  if (!thread.student.equals(req.user._id))
    return next(new ApiError("Only student can accept", 403));

  const message = await Message.findById(messageId);

  message.type = "accept";
  await message.save();

  thread.status = "accepted";
  thread.agreedPrice = message.price;
  await thread.save();

  await Lesson.findByIdAndUpdate(thread.lesson, {
    acceptedTeacher: thread.teacher,
    price: message.price,
    status: "approved"
  });

  await Thread.updateMany(
    { lesson: thread.lesson, _id: { $ne: threadId } },
    { status: "closed" }
  );

  //  realtime
  io.to(threadId.toString()).emit("offerAccepted", {
    price: message.price,
    teacher: thread.teacher
  });

  res.json({ status: "success" });
});

exports.rejectOffer = asyncHandler(async (req, res, next) => {
  const io = getIO();

  const { messageId } = req.params;

  const message = await Message.findById(messageId)
    .populate("thread");

  if (!message) return next(new ApiError("Message not found", 404));

  message.type = "reject";
  await message.save();

  io.to(message.thread._id.toString()).emit("offerRejected", {
    messageId
  });

  res.json({ status: "success" });
});
