const mongoose = require("mongoose");

const accountReactivationRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    requestedStatus: {
      type: String,
      enum: ["inactive", "banned"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
  },
  { timestamps: true }
);

accountReactivationRequestSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model(
  "AccountReactivationRequest",
  accountReactivationRequestSchema
);
