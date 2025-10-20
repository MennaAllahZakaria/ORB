const mongoose = require("mongoose");

// 📦 Subschema for teacher payment info
const paymentInfoSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["bank", "wallet"],
      required: false,
    },
    accountName: String,
    accountNumber: String,
    bankName: String,
    walletProvider: String, // فودافون كاش - أورانج كاش - الخ
    phoneNumber: String,
    payoutRecipientId: String, // ID من Paymob بعد التسجيل
  },
  { _id: false }
);

// 📦 Subschema for teacher profile
const teacherProfileSchema = new mongoose.Schema(
  {
    subjects: {
      type: [String],
      required: true,
    },
    experienceYears: {
      type: Number,
      required: true,
    },
    bio: {
      type: String,
      required: true,
    },
    pricePerHour: {
      type: Number,
      required: true,
    },
    certificate: {
      type: String,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentInfo: paymentInfoSchema,
  },
  { _id: false }
);

// 📦 Subschema for student profile
const studentProfileSchema = new mongoose.Schema(
  {
    grade: {
      type: String,
      enum: [
        "KG1",
        "KG2",
        "Grade 1",
        "Grade 2",
        "Grade 3",
        "Grade 4",
        "Grade 5",
        "Grade 6",
        "Grade 7 (Preparatory 1)",
        "Grade 8 (Preparatory 2)",
        "Grade 9 (Preparatory 3)",
        "Grade 10 (Secondary 1)",
        "Grade 11 (Secondary 2)",
        "Grade 12 (Secondary 3)",
        "University",
        "Other",
      ],
    },
    school: String,
  },
  { _id: false }
);

// 🧩 Main user schema
const userSchema = new mongoose.Schema(
  {
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
      trim: true,
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
      default: "student",
    },

    fcmToken: {
      type: String,
      default: null,
    },

    preferredLang: {
      type: String,
      enum: ["en", "ar"],
      default: "en",
    },

    teacherProfile: {
      type: teacherProfileSchema,
      required: function () {
        return this.role === "teacher";
      },
    },

    studentProfile: {
      type: studentProfileSchema,
      required: function () {
        return this.role === "student";
      },
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

    points: {
    type: Number,
    default: 0,
  },
   level: {
    type: String,
    enum: ["Bronze", "Silver", "Gold", "Platinum"],
    default: "Bronze",
  },

  },
  { timestamps: true }
);

// 🧹 Remove sensitive fields when converting to JSON
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

// 🧠 Before saving, clean unused profiles
userSchema.pre("save", function (next) {
  if (this.role !== "teacher") {
    this.teacherProfile = undefined;
  }
  if (this.role !== "student") {
    this.studentProfile = undefined;
  }
  next();
});


userSchema.methods.updateLevel = function () {
  if (this.points >= 1000) {
    this.level = "Platinum";
  } else if (this.points >= 500) {
    this.level = "Gold";
  } else if (this.points >= 200) {
    this.level = "Silver";
  } else {
    this.level = "Bronze";
  }
};

const User = mongoose.model("User", userSchema);
module.exports = User;
