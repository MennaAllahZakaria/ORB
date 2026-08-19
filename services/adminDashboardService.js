const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Dispute = require("../models/payment/disputeModel");
const Payout = require("../models/payment/payoutModel");
const Support = require("../models/supportModel");

exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const issueFilter = {
    $or: [
      { status: "problem" },
      { finalCompletionStatus: "incomplete" },
      { reviewStatus: { $in: ["disputed", "under_admin_review"] } },
      { disputeFlag: true },
    ],
  };

  const [pendingTeachers, teacherTotal, studentTotal, lessonIssues, openDisputes, pendingPayouts, openSupportTickets, recentTeachers, recentDisputes, recentPayouts] = await Promise.all([
    User.countDocuments({ role: "teacher", "teacherProfile.verificationStatus": "pending" }),
    User.countDocuments({ role: "teacher" }),
    User.countDocuments({ role: "student" }),
    Lesson.countDocuments(issueFilter),
    Dispute.countDocuments({ status: { $in: ["open", "under_review"] } }),
    Payout.countDocuments({ status: { $ne: "completed" } }),
    Support.countDocuments({ status: { $ne: "closed" } }),
    User.find({ role: "teacher", "teacherProfile.verificationStatus": "pending" }).select("firstName lastName email teacherProfile.verificationStatus createdAt").sort({ createdAt: -1 }).limit(5),
    Dispute.find({ status: { $in: ["open", "under_review"] } }).select("lessonId reason status createdAt").sort({ createdAt: -1 }).limit(5),
    Payout.find({ status: { $ne: "completed" } }).select("teacherId amount method status createdAt").sort({ createdAt: -1 }).limit(5),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      generatedAt: new Date(),
      counts: { pendingTeachers, teacherTotal, studentTotal, lessonIssues, openDisputes, pendingPayouts, openSupportTickets },
      queues: { pendingTeachers: recentTeachers, openDisputes: recentDisputes, pendingPayouts: recentPayouts },
    },
  });
});
