const mongoose = require("mongoose");

const supportSchema = new mongoose.Schema(
  {
    user: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "Support request must belong to a user"],
    },
    problemType: {  
        type: String,   
        required: [true, "Problem type is required"],
    }   
    ,
    message: {  
        type: String,   
        required: [true, "Message is required"],
        trim: true,
        maxlength: 1000,
    },
    status: {
      type: String,
        enum: ["open", "in progress", "closed"],
        default: "open",
    },
    image: {
      type: String,
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model("Support", supportSchema);
