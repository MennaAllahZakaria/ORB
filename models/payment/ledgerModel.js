const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  amount: {
    type: Number,
    required: true,
  },

  type: {
    type: String,
    enum: ["credit", "debit"],
    required: true,
  },

  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled"],
    default: "pending",
  },

  source: {
    type: String,
    enum: ["lesson", "refund", "withdraw"],
    required: true,
  },

  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lesson",
  },

  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payment",
  },

  payoutId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payout",
  },

  description: String,

}, { timestamps: true });

ledgerSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Ledger", ledgerSchema);