const crypto = require("crypto");
const Payment = require("../../models/payment/paymentModel");
const { handlePaymentSuccess } = require("./paymentHandleService");

const verifySignature = (payload) => {
  const secret = process.env.EASYKASH_SECRET;

  const dataString =
    payload.customerReference +
    payload.Amount +
    payload.status +
    payload.easykashRef;

  const generated = crypto
    .createHmac("sha256", secret)
    .update(dataString)
    .digest("hex");

  return generated === payload.signatureHash;
};

exports.easykashWebhook = async (req, res) => {
  try {

    const payload = req.body;

    /* ===============================
       1. VALIDATE SIGNATURE
    =============================== */

    const isValid = verifySignature(payload);

    if (!isValid) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    /* ===============================
       2. IDEMPOTENCY CHECK
    =============================== */

    const existingPayment = await Payment.findOne({
      customerReference: payload.customerReference,
      status: "paid",
    });

    if (existingPayment) {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ===============================
       3. STATUS CHECK
    =============================== */

    if (payload.status !== "PAID") {
      return res.status(200).json({ message: "Ignored non-paid status" });
    }

    /* ===============================
       4. PROCESS PAYMENT
    =============================== */

    await handlePaymentSuccess({
      customerReference: payload.customerReference,
      providerRefNum: payload.easykashRef,
      amount: Number(payload.Amount),
    });

    
    return res.status(200).json({ message: "Processed" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Webhook error" });
  }
};