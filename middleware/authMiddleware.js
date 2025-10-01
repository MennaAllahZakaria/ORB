const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");

// ================== PROTECT ==================
exports.protect = asyncHandler(async (req, res, next) => {
    let token;

    // token من Authorization header
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return next(new ApiError("You are not logged in. Please login first.", 401));
    }

    // verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // check user exists
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
        return next(new ApiError("The user belonging to this token no longer exists.", 401));
    }

    // attach user to request
    req.user = currentUser;
    next();
});

// ================== ALLOWED TO ==================
exports.allowedTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
        return next(new ApiError("You do not have permission to perform this action", 403));
        }
        next();
    };
};
