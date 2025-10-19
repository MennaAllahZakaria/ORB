const express = require("express");

const {
    initiatePayment,
    handlePaymentCallback,

} = require("../services/paymentService");  

const { protect, allowedTo } = require("../middleware/authMiddleware");

const { idValidator } = require("../utils/validators/paymentValidator");    

const router = express.Router();

// ================= STUDENT - INITIATE PAYMENT FOR LESSON =================
router.post(
    "/:lessonId/initiate",protect, allowedTo("student"),
    idValidator,
    initiatePayment
);  
// ================= PAYMENT CALLBACK =================
router.post(
    "callback",
    handlePaymentCallback
);  

module.exports = router;