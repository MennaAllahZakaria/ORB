const Payment = require("../../models/payment/paymentModel");
const { handlePaymentSuccess } = require("./paymentHandleService");
const { verifySignature } = require("../../utils/easykashSignature");

exports.easykashWebhook = async (req, res) => {
  try {
    const payload = req.body;

    console.log("📥 Webhook received:", payload);

    /* ===============================
       1. SIGNATURE VALIDATION
    =============================== */

    const isValid = verifySignature(payload);

    if (!isValid) {
      console.error("❌ Invalid signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    /* ===============================
       2. STATUS CHECK
    =============================== */

    if (payload.status !== "PAID") {
      console.log("⏳ Ignored non-paid webhook");
      return res.status(200).json({ message: "Ignored" });
    }

    /* ===============================
       3. IDEMPOTENCY CHECK
    =============================== */

    const payment = await Payment.findOne({
      customerReference: payload.customerReference,
    });

    if (!payment) {
      console.error("❌ Payment not found in DB");
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "paid") {
      console.log("⚠️ Already processed");
      return res.status(200).json({ message: "Already processed" });
    }

    /* ===============================
       4. PROCESS PAYMENT
    =============================== */

    await handlePaymentSuccess({
      customerReference: payload.customerReference,
      providerRefNum: payload.easykashRef,
      amount: Number(payload.Amount),
    });

    console.log("✅ Payment processed from webhook");

    return res.status(200).json({ message: "Processed" });

  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ message: "Webhook error" });
  }
};