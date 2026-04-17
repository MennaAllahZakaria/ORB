const express = require("express");
const router = express.Router();

const {
  resolveDispute,
  getAllDisputes,
} = require("../../services/payment/disputeService");

const { protect , allowedTo } = require("../../middleware/authMiddleware");

/* ===============================
   GET ALL DISPUTES (ADMIN)
=============================== */
router.get("/", protect, allowedTo("admin"), getAllDisputes);

/* ===============================
   RESOLVE DISPUTE
=============================== */
router.post("/resolve", protect, allowedTo("admin"), resolveDispute);

module.exports = router;