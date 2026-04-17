const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lesson",
  },

  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payment",
  },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  reason: {
    type: String,
    enum: ["no_show", "quality", "technical", "other"],
  },

  description: String,

  evidence: [
    {
      type: String,
      url: String,
    }
  ],

  systemData: {
    sessionVerified: Boolean,
    duration: Number,
  },

  status: {
    type: String,
    enum: ["open", "under_review", "resolved"],
    default: "open",
  },

  resolution: {
    decision: {
      type: String,
      enum: ["refund", "release", "partial"],
    },
    amount: Number,
    note: String,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },

  resolvedAt: Date,

}, { timestamps: true });

module.exports = mongoose.model("Dispute", disputeSchema);