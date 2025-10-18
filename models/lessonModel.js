const mongoose = require("mongoose");

const lessonSchema = new mongoose.Schema({
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
    requistedDate: {
        type: Date,
        required: [true, "requistedDate required"],
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
    interestedTeachers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    acceptedTeacher: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: "User" 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
},{ timestamps: true });

module.exports = mongoose.model("Lesson", lessonSchema);