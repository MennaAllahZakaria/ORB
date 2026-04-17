const Payout = require("../../models/payment/payoutModel");
const Ledger = require("../../models/payment/ledgerModel");

module.exports = async () => {

  const failed = await Payout.find({
    status: "failed",
  }).limit(10);

  for (const payout of failed) {
    try {
      // هنا تحطي integration حقيقي أو manual trigger

      payout.status = "processing";
      await payout.save();

      // simulate success
      payout.status = "completed";
      payout.processedAt = new Date();
      await payout.save();

      await Ledger.updateMany(
        { payoutId: payout._id },
        { status: "confirmed" }
      );

    } catch (err) {
      console.error("retry payout error:", err.message);
    }
  }
};