const mongoose = require("mongoose");
const User = require("./userModel");
const Lesson = require("./lessonModel");

const reviewSchema = new mongoose.Schema(
  {
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: [true, "Review must belong to a lesson"],
      unique: true, 
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Review must belong to a student"],
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Review must belong to a teacher"],
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: [true, "Rating required"],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// 📌 Populate student & teacher when getting reviews
reviewSchema.pre(/^find/, function (next) {
  this.populate({
    path: "student",
    select: "firstName lastName imageProfile",
  }).populate({
    path: "teacher",
    select: "firstName lastName teacherProfile.subjects",
  });
  next();
});

// 📊 Calculate and update average rating for the teacher
reviewSchema.statics.calcAverageRatings = async function (teacherId) {
  const stats = await this.aggregate([
    { $match: { teacher: teacherId } },
    {
      $group: {
        _id: "$teacher",
        avgRating: { $avg: "$rating" },
        nRatings: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await User.findByIdAndUpdate(teacherId, {
      "teacherProfile.avgRating": stats[0].avgRating.toFixed(1),
      "teacherProfile.totalReviews": stats[0].nRatings,
    });
  } else {
    // No reviews, reset to default values
    await User.findByIdAndUpdate(teacherId, {
      "teacherProfile.avgRating": 0,
      "teacherProfile.totalReviews": 0,
    });
  }
};

// ✅ Run after save/update/delete
reviewSchema.post("save", function () {
  this.constructor.calcAverageRatings(this.teacher);
});

reviewSchema.post("findOneAndDelete", function (doc) {
  if (doc) doc.constructor.calcAverageRatings(doc.teacher);
});

reviewSchema.post("remove", function () {
  this.constructor.calcAverageRatings(this.teacher);
});

module.exports = mongoose.model("Review", reviewSchema);
