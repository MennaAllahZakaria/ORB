const express = require("express");
const { zoomWebhook } = require("../services/zoomService");

const router = express.Router();

// Zoom calls this endpoint without an ORB JWT.
router.post("/webhook", zoomWebhook);

module.exports = router;
