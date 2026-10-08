const asyncHandler = require("express-async-handler");
const HandlerFactory = require("./handlerFactory");
const Support = require("../models/supportModel");
const User = require("../models/userModel");
const ApiError = require("../utils/apiError");
const { uploadSingleImage } = require("../middleware/uploadImageMiddleware");
const sendEmail = require("../utils/sendEmail");


exports.uploadSupportImage = uploadSingleImage("image");

// ===============================
// 🎯 Create new support request
// ===============================
exports.createSupportRequest = asyncHandler(async (req, res, next) => {
  const { problemType, message } = req.body;
    if (!problemType) {
    return next(new ApiError("problemType is required", 400));
  }
    if (!message) {
    return next(new ApiError("message is required", 400));
  }
    const image = req.imageUrl || "";

    const supportRequest = await Support.create({
    user: req.user._id,
    problemType,
    message,
    image,
  });
    res.status(201).json({
    status: "success",
    data: supportRequest,
  });

});
        

// ===============================
// 🎯 Get all support requests
// ===============================
exports.getAllSupportRequests = asyncHandler(async (req, res) => {
  const supportRequests = await Support.find()
    .populate("user", "firstName lastName email role")
    .populate("adminRepliedBy", "firstName lastName email")
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: supportRequests.length,
    data: supportRequests,
  });
});

// ===============================
// 🎯 Get specific support request
// ===============================
exports.getSupportRequest = HandlerFactory.getOne(Support);

// ===============================
// Reply to a support request and notify the user by email
// ===============================
exports.replyToSupportRequest = asyncHandler(async (req, res, next) => {
  const reply = typeof req.body.reply === "string" ? req.body.reply.trim() : "";
  if (!reply) {
    return next(new ApiError("reply is required", 400));
  }

  const supportRequest = await Support.findById(req.params.id);
  if (!supportRequest) {
    return next(new ApiError("Support request not found", 404));
  }

  const user = await User.findById(supportRequest.user).select("firstName lastName email");
  if (!user?.email) {
    return next(new ApiError("Support requester email is not available", 400));
  }

  supportRequest.adminReply = reply;
  supportRequest.adminRepliedAt = new Date();
  supportRequest.adminRepliedBy = req.user._id;
  supportRequest.status = "in progress";
  await supportRequest.save();

  try {
    await sendEmail({
      Email: user.email,
      subject: `ORB Support reply: ${supportRequest.problemType}`,
      message: `Hi ${user.firstName} ${user.lastName},\n\nOur support team replied to your request:\n\n${reply}\n\nOriginal request: ${supportRequest.message}\n\nYou can reply through the ORB support section if you need more help.\n\nORB Support`,
    });
  } catch (emailError) {
    console.error("Error sending support reply email:", emailError.message);
    return next(new ApiError("The reply was saved, but the email could not be sent", 502));
  }

  res.status(200).json({
    status: "success",
    message: "Support reply saved and emailed successfully",
    data: supportRequest,
  });
});

// ===============================
// 🎯 Update support request
// ===============================
exports.updateSupportRequest = asyncHandler(async (req, res, next) => {
  const supportRequest = await Support.findById(req.params.id);
    if (!supportRequest) {
    return next(new ApiError("Support request not found", 404));
  }
  if (req.user.id.toString() !== supportRequest.user.toString() && req.user.role !== "admin") {
    return next(new ApiError("You are not allowed to update this support request", 403));
  }
    supportRequest.problemType = req.body.problemType || supportRequest.problemType;
    supportRequest.message = req.body.message || supportRequest.message;
    if (req.imageUrl) {
    supportRequest.image = req.imageUrl || supportRequest.image;
    }
    await supportRequest.save();
    res.status(200).json({
    status: "success",
    data: supportRequest,
  });
});

// ===============================
// 🎯 Get support requests for logged-in user
// ===============================
exports.getMySupportRequests = asyncHandler(async (req, res, next) => {
  const supportRequests = await Support.find({ user: req.user._id })
    .populate("adminRepliedBy", "firstName lastName email")
    .sort({ createdAt: -1 });
    res.status(200).json({
    status: "success",
    results: supportRequests.length,
    data: supportRequests,
  });
});

// ===============================
// 🎯 Close a support request
// ===============================
exports.closeSupportRequest = asyncHandler(async (req, res, next) => {
  const supportRequest = await Support.findByIdAndUpdate(
    req.params.id,
    { status: "closed" },
    { new: true }
  );
    if (!supportRequest) {
    return next(new ApiError("Support request not found", 404));
  }
    res.status(200).json({
    status: "success",
    data: supportRequest,
  });
});

// ===============================
// 🎯 Reopen a support request
// ===============================
exports.reopenSupportRequest = asyncHandler(async (req, res, next) => {
    const supportRequest = await Support.findByIdAndUpdate(
    req.params.id,
    { status: "open" },
    { new: true }
  );
    if (!supportRequest) {
    return next(new ApiError("Support request not found", 404));
  }
    res.status(200).json({
    status: "success",
    data: supportRequest,
  });
});
