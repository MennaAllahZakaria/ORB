const Dispute = require("../../models/payment/disputeModel");
const Lesson = require("../../models/lessonModel");
const User = require("../../models/userModel");
const { handleDisputeResolution } = require("./paymentHandleService");
const { sendNotification } = require("../../utils/notificationHelper");

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

  // Notify Student and Teacher
  const dispute = await Dispute.findById(disputeId);
  const lesson = await Lesson.findById(dispute.lessonId);
  const student = await User.findById(dispute.studentId);
  const teacher = await User.findById(dispute.teacherId);

  if (student) {
    setImmediate(() => {
      sendNotification({
        recipient: student,
        titleEn: "⚖️ Dispute Resolved",
        titleAr: "⚖️ تم حل النزاع",
        bodyEn: `The dispute for lesson "${lesson.title}" has been resolved. Decision: ${decision}.`,
        bodyAr: `تم حل النزاع الخاص بالحصة "${lesson.title}". القرار: ${decision === 'refund' ? 'استرداد المبلغ' : decision === 'release' ? 'تحويل المبلغ للمدرس' : 'حل جزئي'}.`,
        data: { type: "dispute_resolved", lessonId: lesson._id.toString() }
      });
    });
  }

  if (teacher) {
    setImmediate(() => {
      sendNotification({
        recipient: teacher,
        titleEn: "⚖️ Dispute Resolved",
        titleAr: "⚖️ تم حل النزاع",
        bodyEn: `The dispute for lesson "${lesson.title}" has been resolved. Decision: ${decision}.`,
        bodyAr: `تم حل النزاع الخاص بالحصة "${lesson.title}". القرار: ${decision === 'release' ? 'تحويل المبلغ لك' : decision === 'refund' ? 'استرداد المبلغ للطالب' : 'حل جزئي'}.`,
        data: { type: "dispute_resolved", lessonId: lesson._id.toString() }
      });
    });
  }

  res.status(200).json({
    message: "Dispute resolved successfully",
    data: result,
  });
};