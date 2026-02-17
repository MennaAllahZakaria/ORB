const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
{
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LessonNegotiationThread",
    required: true,
    index: true
  },

  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  role: {
    type: String,
    enum: ["student", "teacher"],
    required: true
  },

  price: {
    type: Number,
    min: 1
  },

  message: {
    type: String,
    maxlength: 500
  },

  type: {
    type: String,
    enum: ["offer", "accept", "reject", "system"],
    default: "offer"
  }
},
{ timestamps: true }
);

/*
 أهم index عشان pagination
*/
messageSchema.index({ thread: 1, createdAt: 1 });

module.exports = mongoose.model("LessonNegotiationMessage", messageSchema);
