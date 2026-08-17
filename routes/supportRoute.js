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
const { auditOnSuccess } = require("../middleware/auditMiddleware");

const {uploadImageAndFile, attachUploadedLinks} = require("../middleware/uploadFileMiddleware");

const router = express.Router();

// ================= USER - CREATE SUPPORT REQUEST =================
router.post(
    "/",
    protect,
    allowedTo("student", "teacher", "admin"),
    uploadImageAndFile, attachUploadedLinks,
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
    uploadImageAndFile, attachUploadedLinks,
    auditOnSuccess({ action: "support.updated", entityType: "SupportTicket" }),
    updateSupportRequest
);

// ================= USER - CLOSE SUPPORT REQUEST =================
router.put(
    "/:id/close",
    protect,
    allowedTo("admin"),
    auditOnSuccess({ action: "support.closed", entityType: "SupportTicket" }),
    closeSupportRequest
);
// ================= USER - REOPEN SUPPORT REQUEST =================
router.put(
    "/:id/reopen",
    protect,
    allowedTo("admin"),
    auditOnSuccess({ action: "support.reopened", entityType: "SupportTicket" }),
    reopenSupportRequest
);
module.exports = router;
