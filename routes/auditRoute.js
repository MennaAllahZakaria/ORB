const express = require("express");
const { protect, allowedTo } = require("../middleware/authMiddleware");
const { listAuditLogs } = require("../services/auditService");

const router = express.Router();

router.use(protect, allowedTo("superAdmin"));
router.get("/", listAuditLogs);

module.exports = router;
