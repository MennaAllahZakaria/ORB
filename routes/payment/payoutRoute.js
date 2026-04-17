const express = require("express");
const router = express.Router();

const {
  requestPayout,
  completePayout,
} = require("../../services/payment/payoutService");

const { protect , allowedTo } = require("../../middleware/authMiddleware");

/* ===============================
   REQUEST PAYOUT
=============================== */
router.post("/", protect, requestPayout);

/* ===============================
   COMPLETE PAYOUT (ADMIN)
=============================== */
router.patch("/:id/complete", protect, allowedTo("admin"), completePayout);

module.exports = router;