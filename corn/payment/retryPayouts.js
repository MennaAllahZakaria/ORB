const Payout = require("../../models/payment/payoutModel");

module.exports = async () => {

  const failed = await Payout.find({
    status: "failed",
  }).limit(10);

  for (const payout of failed) {
    try {
      // Do not mark a payout as completed without a real provider response or
      // an admin completing it through the protected payout endpoint.
      console.warn(
        `[Payout] Skipping automatic retry for failed payout ${payout._id}; provider integration is required.`
      );

    } catch (err) {
      console.error("retry payout error:", err.message);
    }
  }
};
