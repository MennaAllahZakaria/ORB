const express = require("express");
const router = express.Router();

const {
  requestPayout,
  completePayout,
  getMyPayouts,
  getAllPayouts
} = require("../../services/payment/payoutService");

const { protect , allowedTo } = require("../../middleware/authMiddleware");

/* ===============================
   REQUEST PAYOUT
=============================== */
router.post("/", protect, allowedTo("teacher"), requestPayout);

/* ===============================
   COMPLETE PAYOUT (ADMIN)
=============================== */
router.patch("/:id/complete", protect, allowedTo("admin"), completePayout);

/* ===============================
   GET MY PAYOUTS
=============================== */
router.get("/my-payouts", protect, allowedTo("teacher"), getMyPayouts);

/* ===============================
   GET ALL PAYOUTS (ADMIN)
=============================== */
router.get("/", protect, allowedTo("admin"), getAllPayouts);

module.exports = router;