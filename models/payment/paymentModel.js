const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lesson",
    required: true,
  },

  amount: {
    type: Number,
    required: true,
  },

  currency: {
    type: String,
    default: "EGP",
  },

  provider: {
    type: String,
    default: "easykash",
  },

  providerRefNum: String,

  customerReference: String,

  status: {
    type: String,
    enum: ["pending", "paid", "failed", "refunded"],
    default: "pending",
  },

  paidAt: Date,

  isProcessed: {
    type: Boolean,
    default: false
  },

}, { timestamps: true });

paymentSchema.index({ providerRefNum: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
