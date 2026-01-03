const mongoose = require("mongoose");

/* =========================
   PAYMENT SUBSCHEMA
========================= */
const paymentSchema = new mongoose.Schema(
  {
    amount: Number,
    paymobOrderId: String,
    transactionId: String,

    // 💸 Disbursement
    disburseTransactionId: String,
    disbursementStatus: String,
    disbursementCode: String,
    disbursementDescription: String,
    clientReference: String,

    status: {
      type: String,
      enum: ["pending", "paid", "failed", "released", "refunded"],
      default: "pending",
    },
  },
  { _id: false }
);


/* =========================
   LESSON SCHEMA
========================= */
const lessonSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    subject: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    offers: [
      {
        teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        proposedPrice: Number,
        message: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    requestedDate: {
      type: Date,
      required: true,
    },

    durationInMinutes: {
      type: Number,
      required: true,
    },

    /* =====================
       LESSON STATUS
    ===================== */
    status: {
      type: String,
      enum: ["pending", "approved", "completed", "canceled"],
      default: "pending",
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

    /* =====================
       PAYMENT STATUS (HIGH LEVEL)
    ===================== */
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "released", "refunded"],
      default: "unpaid",
    },

    payment: paymentSchema,

    amountPaid: {
      type: Number,
      default: 0, // net amount sent to teacher
    },

    /* =====================
       FEES
    ===================== */
    fees: {
      platform: { type: Number, default: 0 },
      gateway: { type: Number, default: 0 },
    },

    /* =====================
       ZEGO MEETING
    ===================== */
    meetingRoomId: {
      type: String,
      default: null,
    },

    meetingStatus: {
      type: String,
      enum: ["upcoming", "ongoing", "finished", "canceled"],
      default: "upcoming",
    },

    meetingStartTime: {
      type: Date,
      default: null,
    },

    meetingEndTime: {
      type: Date,
      default: null,
    },

    zegoTokenForStudent: {
      type: String,
      default: null,
    },

    zegoTokenForTeacher: {
      type: String,
      default: null,
    },

    activeParticipants: {
      type: [String],
      default: [],
    },

    // lesson completion 
    completion: {
      type: String,
      enum : ["completed", "incomplete"],
      default: null,
    },
    reason_for_incomplete: {
      type: String,
      enum : ["no_show_student","no_show_tyeacher ", "technical_issues_by_stydent", "technical_issues_by_teacher", "canceled_by_agreement", "other"],
      default: null,
    },

  },
  { timestamps: true }
);

/* =========================
   VIRTUALS
========================= */
lessonSchema.virtual("durationMinutes").get(function () {
  if (this.meetingStartTime && this.meetingEndTime) {
    const diff = (this.meetingEndTime - this.meetingStartTime) / 1000 / 60;
    return Math.round(diff);
  }
  return 0;
});

module.exports = mongoose.model("Lesson", lessonSchema);
