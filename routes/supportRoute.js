const express = require("express");

const {
    createSupportRequest,
    getAllSupportRequests,
    getSupportRequest,
    updateSupportRequest,
    getMySupportRequests,
    closeSupportRequest,
    reopenSupportRequest,
    uploadSupportImage,
} = require("../services/supportService");

const { protect, allowedTo } = require("../middleware/authMiddleware");
const router = express.Router();

// ================= USER - CREATE SUPPORT REQUEST =================
router.post(
    "/",
    protect,
    allowedTo("student", "teacher", "admin"),
    uploadSupportImage,
    createSupportRequest
);
// ================= ALL USERS - GET ALL SUPPORT REQUESTS =================
router.get(
    "/",
    protect,
    allowedTo("admin"),
    getAllSupportRequests
);
// ================= ALL USERS - GET MY SUPPORT REQUESTS =================
router.get(
    "/my-requests",
    protect,
    allowedTo("student", "teacher"),
    getMySupportRequests
);
// ================= ALL USERS - GET A SUPPORT REQUEST =================
router.get(
    "/:id",
    protect,
    allowedTo( "admin"),
    getSupportRequest
);
// ================= USER - UPDATE SUPPORT REQUEST =================
router.put(
    "/:id",
    protect,
    allowedTo("admin" , "student", "teacher"),
    uploadSupportImage,
    updateSupportRequest
);

// ================= USER - CLOSE SUPPORT REQUEST =================
router.put(
    "/:id/close",
    protect,
    allowedTo("student", "teacher"),
    closeSupportRequest
);
// ================= USER - REOPEN SUPPORT REQUEST =================
router.put(
    "/:id/reopen",
    protect,
    allowedTo("student", "teacher"),
    reopenSupportRequest
);
module.exports = router;