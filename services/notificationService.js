const asyncHandler = require("express-async-handler");

const ApiError = require("../utils/apiError");

const Notification = require('../models/notificationModel');
const User = require("../models/userModel");

const HandlerFactory = require("./handlerFactory");

// @desc    Get all notifications of logged user
// @route   GET /notifications/all
// @access  Private/user

exports.getNotifications = asyncHandler(async (req, res, next) => {
    let filter = {};
    // admin: get all notification in system 
    // user : get only his notification
    if (req.user.role === 'student' || req.user.role === 'teacher') {
        filter.recipient = req.user.id;
    }
    const notifications = await Notification.find(filter)
                                            .sort({ createdAt: -1 })
                                            .populate("recipient", "firstName lastName email")
                                            .populate("sendBy", "firstName lastName email");

    if (!notifications) {
        return next(new ApiError("No notifications found for this user", 404));
    }

    res.status(200).json({ results:notifications.length, data: notifications });
});
// @desc    Get notification of logged user by id
// @route   GET /notifications/:id
// @access  Private/user

exports.getNotificationById = asyncHandler(async (req, res, next) => {
    const notification = await Notification.findById(req.params.id)
                                            .populate("recipient", "firstName lastName email")
                                            .populate("sendBy", "firstName lastName email");

    if (req.user.role==="student" || req.user.role==="teacher") {
        if (req.user.id.toString() !== notification.recipient.toString()) {
            return next(new ApiError("You are not the recipient of this notification", 401));
        }
    }

    if (!notification) {
        return next(new ApiError("No notification found with this ID", 404));
    }

    res.status(200).json({ data: notification });
});

// @desc    Mark notification as read
// @route   PUT /notifications/read/:id
// @access  Private/user

exports.markNotificationAsRead = asyncHandler(async (req, res, next) => {
    const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });

    if (!notification) {
        return next(new ApiError("No notification found with this ID", 404));
    }

    res.status(200).json({ data: notification });
});

// @desc    Delete notification
// @route   DELETE /notifications/:id
// @access  Private/user

exports.deleteNotification = HandlerFactory.deleteOne(Notification);

// @desc    Delete all notification of logged user
// @route   DELETE /notifications/all
// @access  Private/user

exports.deleteAllNotifications = asyncHandler(async (req, res, next) => {
    await Notification.deleteMany({ recipient: req.user.id });

    res.status(204).json({ msg: "Deleted" });
});


// @desc    add notification from admin
// @route   POST /notifications
// @access  Private/admin

exports.addNotification=asyncHandler(async(req,res,next)=>{
    const { title, message, userEmail } = req.body;
    
    const recipientId = await User.findOne({ email: userEmail });
    const adminId = req.user._id; 

    if (!title || !message || !recipientId) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const notification = await Notification.create({
        title,
        message,
        recipient: recipientId._id,
        sendBy: adminId,
    });

    res.status(201).json({
        status: 'success',
        data: notification,
    });
})