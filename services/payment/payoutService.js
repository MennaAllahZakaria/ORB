const Payout = require("../../models/payment/payoutModel");
const { handlePayout } = require("./paymentHandleService");

exports.requestPayout = async (req, res) => {
  const { amount, method, details } = req.body;

  const payout = await handlePayout({
    teacherId: req.user._id,
    amount,
    method,
    details,
  });

  res.json(payout);
};

exports.completePayout = async (req, res) => {
  const payout = await Payout.findById(req.params.id);

  if (!payout) {
    return res.status(404).json({ message: "Not found" });
  }

  payout.status = "completed";
  payout.processedAt = new Date();

  await payout.save();

  res.json(payout);
};