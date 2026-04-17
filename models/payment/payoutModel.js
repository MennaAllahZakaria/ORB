const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  amount: {
    type: Number,
    required: true,
  },

  method: {
    type: String,
    enum: ["wallet", "bank"],
    required: true,
  },

  details: {
    walletNumber: String,
    bankName: String,
    accountNumber: String,
    accountHolderName: String,
  },

  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },

  processedAt: Date,

}, { timestamps: true });

module.exports = mongoose.model("Payout", payoutSchema);