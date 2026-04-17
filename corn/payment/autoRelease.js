const Lesson = require("../../models/lessonModel");
const { handleLessonCompletion } = require("../../services/payment/paymentService");

module.exports = async () => {

  const lessons = await Lesson.find({
    paymentStatus: "paid",
    fundsStatus: "held",
    studentConfirmed: null,
    updatedAt: { $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).limit(20);

  for (const lesson of lessons) {
    try {
      lesson.studentConfirmed = true; // auto approve
      await lesson.save();

      await handleLessonCompletion(lesson._id);

    } catch (err) {
      console.error("autoRelease error:", err.message);
    }
  }
};