const mongoose = require("mongoose");

const threadSchema = new mongoose.Schema(
{
  lesson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lesson",
    required: true,
    index: true
  },

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  status: {
    type: String,
    enum: ["negotiating", "accepted", "rejected", "closed"],
    default: "negotiating",
    index: true
  },

  agreedPrice: Number,

  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  }
},
{ timestamps: true }
);

/*
 يمنع وجود أكتر من thread لنفس المدرس في نفس الدرس
 أهم index في السيستم كله
*/

threadSchema.index({ lesson: 1, teacher: 1 }, { unique: true });

module.exports = mongoose.model("LessonNegotiationThread", threadSchema);
