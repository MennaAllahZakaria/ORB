const Payment = require("../../models/payment/paymentModel");
const { handlePaymentSuccess } = require("../../services/payment/paymentService");
const axios = require("axios");

module.exports = async () => {
  const pendingPayments = await Payment.find({
    status: "pending",
    createdAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) }, // أقدم من 5 دقايق
  }).limit(20);

  for (const payment of pendingPayments) {
    try {
      const res = await axios.post(
        "https://back.easykash.net/api/cash-api/inquire",
        { customerReference: payment.customerReference },
        {
          headers: {
            authorization: process.env.EASYKASH_API_KEY,
          },
        }
      );

      if (res.data.status === "PAID") {
        await handlePaymentSuccess({
          customerReference: payment.customerReference,
          providerRefNum: res.data.easykashRef,
          amount: Number(res.data.Amount),
        });
      }

    } catch (err) {
      console.error("verifyPendingPayments error:", err.message);
    }
  }
};