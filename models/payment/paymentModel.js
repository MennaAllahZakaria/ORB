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
    enum: ["pending", "paid", "failed", "refunded" , "refund_pending"],
    default: "pending",
  },

  paidAt: Date,

  isProcessed: {
    type: Boolean,
    default: false
  },

  refund: {
    status: {
        type: String,
        enum: ["none","pending","completed"],
        default:"none"
    },

    requestedAt: Date,

    completedAt: Date,

    amount:Number,

    note:String,

    processedBy:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
    }
},

}, { timestamps: true });

paymentSchema.index({ providerRefNum: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
