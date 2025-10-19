const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      default: 0,
    },
    paymobOrderId: {
      type: String,
      default: null,
    },
    transactionId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "released", "refunded"],
      default: "pending",
    },
  },
  { _id: false }
);

const lessonSchema = new mongoose.Schema(
  {
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "student id required"],
    },

    title: {
        type: String,
        required: [true, "title required"],
    },

    subject: {
        type: String,
        required: [true, "subject required"],
    },

    price: {
        type: Number,
        required: [true, "price required"],
    },

    requestedDate: {
        type: Date,
        required: [true, "requestedDate required"],
    },

    durationInMinutes: {
        type: Number,
        required: [true, "durationInMinutes required"],
    },

    status: {
        type: String,
        enum: ["pending", "approved", "completed", "canceled"],
        default: "pending"
    },

    interestedTeachers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    acceptedTeacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // 💳 Payment info
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "held", "released", "refunded"],
      default: "unpaid",
    },

    payment: paymentSchema, // nested payment object

    amountPaid: {
      type: Number,
      default: 0,
    },

    teacherPayoutId: {
      type: String,
      default: null, // ID for payout transaction (when released)
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lesson", lessonSchema);