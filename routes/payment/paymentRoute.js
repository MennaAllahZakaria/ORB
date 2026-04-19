const express = require("express");
const router = express.Router();

const {
  createPayment,
  getPaymentById,
  getMyPayments,
} = require("../../services/payment/paymentService");

const { protect } = require("../../middleware/authMiddleware");

/* ===============================
   CREATE PAYMENT LINK
=============================== */
router.post("/create", protect, createPayment);

/* ===============================
   GET MY PAYMENTS
=============================== */
router.get("/my-payments", protect, getMyPayments);

/* ===============================
   GET PAYMENT
=============================== */
router.get("/:id", protect, getPaymentById);

module.exports = router;