const asyncHandler = require("express-async-handler");
const HandlerFactory = require("./handlerFactory");
const Support = require("../models/supportModel");
const ApiError = require("../utils/apiError");
const { uploadSingleImage } = require("../middleware/uploadImageMiddleware");


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
exports.getAllSupportRequests = HandlerFactory.getAll(Support);

// ===============================
// 🎯 Get specific support request
// ===============================
exports.getSupportRequest = HandlerFactory.getOne(Support);

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
  const supportRequests = await Support.find({ user: req.user._id });
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

