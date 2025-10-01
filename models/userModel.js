const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        trim: true,
        required: [true, "firstName required"],
    },
    lastName: {
        type: String,
        trim: true,
        required: [true, "lastName required"],
    },
    email: {
        type: String,
        unique: true,
        required: [true, "email required"],
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: [true, "password required"],
        minlength: [8, "too short password"],
    },

    passwordChangedAt: Date,
    passwordResetCode: String,
    passwordResetExpires: Date,
    passwordResetVerified: Boolean,

    role: {
        type: String,
        enum: ["student", "teacher", "admin"],
        default: "student"
    },

    // 📌 only for teachers
    teacherProfile: {
        subjects: [String],
        experienceYears: Number,
        bio: String,
        pricePerHour: Number,
        certificate: {
        type: String,
        required: function() { return this.role === "teacher"; }
        },
        verificationStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending"
        }
    },

    // 📌 only for students
    studentProfile: {
        grade: {
        type: String,
        enum: [
            "KG1", "KG2",
            "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
            "Grade 7 (Preparatory 1)", "Grade 8 (Preparatory 2)", "Grade 9 (Preparatory 3)",
            "Grade 10 (Secondary 1)", "Grade 11 (Secondary 2)", "Grade 12 (Secondary 3)",
            "University", "Other"
        ],
        required: function() { return this.role === "student"; }
        },
        school: String
    },

    status: {
        type: String,
        default: "active",
        enum: ["active", "inactive", "banned"],
    },
    imageProfile: {
        type: String,
        default: null,
    },
    phone: {
        type: String,
        default: null,
    },
}, { timestamps: true });

userSchema.set("toJSON", {
    transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        delete ret.passwordResetCode;
        delete ret.passwordResetExpires;
        delete ret.passwordResetVerified;
        return ret;
    },
});

const User = mongoose.model("User", userSchema);
module.exports = User;
