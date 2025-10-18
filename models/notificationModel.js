const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    sendBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
    read: {
        type: Boolean,
        default: false,
    },  
    createdAt: {
        type: Date,
        default: Date.now,
    },
    expires: {
        type: Date,
        default: () => Date.now() + 7 * 24 * 60 * 60 * 1000, // one week
    }
},{
    timestamps: true,
});

// to remove expires notfication 
notificationSchema.index({ "expires": 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Notification", notificationSchema);