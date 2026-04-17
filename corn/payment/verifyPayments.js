const Payment = require("../../models/payment/paymentModel");
const { handlePaymentSuccess } = require("../../services/payment/paymentService");
const axios = require("axios");

module.exports = async () => {

  console.log(" Running verifyPendingPayments job...");

  const pendingPayments = await Payment.find({
    status: "pending",
    createdAt: { $lte: new Date(Date.now() - 2 * 60 * 1000) } // 2 min
  }).limit(20);

  for (const payment of pendingPayments) {

    try {

      console.log(`🔍 Checking payment: ${payment._id}`);

      if (Date.now() - payment.createdAt > 30 * 60 * 1000) {
        payment.status = "failed";
        await payment.save();
        console.log(`⏰ Payment expired: ${payment._id}`);
        continue;
      }

      const res = await axios.post(
        "https://back.easykash.net/api/cash-api/inquire",
        { customerReference: payment.customerReference },
        {
          headers: {
            authorization: process.env.EASYKASH_API_KEY,
          },
          timeout: 10000,
        }
      );

      const data = res.data;

      console.log(` EasyKash status: ${data.status}`);

      /* ===============================
         STATUS HANDLING
      =============================== */

      //  SUCCESS
      if (data.status === "PAID") {

        // amount validation
        if (Number(data.Amount) !== payment.amount) {
          console.error(`❌ Amount mismatch for payment ${payment._id}`);
          continue;
        }

        await handlePaymentSuccess({
          customerReference: payment.customerReference,
          providerRefNum: data.easykashRef,
          amount: Number(data.Amount),
        });

        console.log(`✅ Payment confirmed: ${payment._id}`);
      }

      //  FAILED / EXPIRED
      else if (["FAILED", "EXPIRED", "CANCELED"].includes(data.status)) {

        payment.status = "failed";
        await payment.save();

        console.log(`❌ Payment failed: ${payment._id}`);
      }

      //  REFUNDED
      else if (data.status === "REFUNDED") {

        payment.status = "refunded";
        await payment.save();

        console.log(`🔁 Payment refunded: ${payment._id}`);
      }

      //  STILL PENDING
      else {
        console.log(`⏳ Still pending: ${payment._id}`);
      }

    } catch (err) {

      const errorMsg = err.response?.data?.error;

      if (errorMsg?.includes("customerReference not found")) {

        console.log("⚠️ Invalid payment reference, marking failed");

        payment.status = "failed";
        await payment.save();
      }
      console.error(`❌ Error verifying payment ${payment._id}:`, err.message);
      continue;
    }
  }

  console.log("✅ verifyPendingPayments job finished");
};