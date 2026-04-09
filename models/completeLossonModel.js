const mongoose = require("mongoose");

const completeSchema = new mongoose.Schema(
  {
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
    },

    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      enum: ["student", "teacher"],
      required: true,
    },

    completionStatus: {
      type: String,
      enum: ["completed", "incomplete"],
      required: true,
    },

    reasonForIncomplete: {
      type: String,
      default: null,
    },

    reviewStatus: {
        type: String,
        enum: [
            "waiting_second_party",
            "auto_resolved",
            "disputed",
            "under_admin_review",
            "resolved_by_admin"
        ],
        default: "waiting_second_party",
        },

    description: {
      type: String,
      trim: true,
    },

    proofImage: {
      type: String,
    },

    adminReview: {
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
      adminNote: String,
    },
  },
  { timestamps: true }
);

completeSchema.index(
  { lesson: 1, role: 1  },
  { unique: true }
);


module.exports = mongoose.model("CompleteLesson", completeSchema);