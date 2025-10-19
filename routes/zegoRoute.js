const express = require("express");

const { zegoCallback } = require("../services/zegoService");

const router = express.Router();

// ================= ZEGO - CALLBACK =================
router.post("/callback", zegoCallback);
module.exports = router;