const express = require("express");
const router = express.Router();

const {
  createPayment,
  getPaymentById,
} = require("../../services/payment/paymentService");

const { protect } = require("../../middleware/authMiddleware");

/* ===============================
   CREATE PAYMENT LINK
=============================== */
router.post("/create", protect, createPayment);

/* ===============================
   GET PAYMENT
=============================== */
router.get("/:id", protect, getPaymentById);

module.exports = router;