const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");

// ================== PROTECT ==================
exports.protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization) {
        if (req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        } else {
            token = req.headers.authorization;
        }
    }

    if (!token) {
        return next(new ApiError("You are not logged in. Please login first.", 401));
    }

    // verify token
    let decoded;

    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    } catch (err) {
        return next(new ApiError("Invalid or expired token. Please login again.", 401));
    }
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
        return next(new ApiError("The user belonging to this token no longer exists.", 401));
    }
    if (currentUser.passwordChangedAt) {
        const passwordChangedTimestamp = parseInt(currentUser.passwordChangedAt.getTime() / 1000, 10);  

        if (decoded.iat < passwordChangedTimestamp) {
            return next(new ApiError("User recently changed password! Please login again.", 401));
        }
    }

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
