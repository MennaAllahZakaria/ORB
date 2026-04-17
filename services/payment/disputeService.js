const Dispute = require("../../models/payment/disputeModel");
const { handleDisputeResolution } = require("./paymentHandleService");

exports.getAllDisputes = async (req, res) => {
  const disputes = await Dispute.find().populate("lessonId");
  res.status(200).json({
    message: "Disputes retrieved successfully",
    data: disputes,
  });
};

exports.resolveDispute = async (req, res) => {
  const { disputeId, decision, refundAmount } = req.body;

  const result = await handleDisputeResolution({
    disputeId,
    decision,
    refundAmount,
    adminId: req.user._id,
  });

  res.status(200).json({
    message: "Dispute resolved successfully",
    data: result,
  });
};