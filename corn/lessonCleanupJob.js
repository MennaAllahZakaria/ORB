const cron = require("node-cron");
const Lesson = require("../models/lessonModel");

exports.runLessonCleanupJob = async () => {
  cron.schedule("*/30 * * * *", async () => {
    console.log("[CRON] Running lesson cleanup...");
    try {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      // 1. Clean up old pending requests (by creation date)
      const resultOld = await Lesson.updateMany(
        {
          status: "pending",
          acceptedTeacher: null,
          createdAt: { $lt: twoDaysAgo }
        },
        { status: "expired" }
      );

      // 2. Clean up pending requests whose requested date has passed
      // We give a 6 hour buffer after the requested date to allow for late applications
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const resultPassed = await Lesson.updateMany(
        {
          status: "pending",
          acceptedTeacher: null,
          requestedDate: { $lt: sixHoursAgo }
        },
        { status: "expired" }
      );

      console.log(`[CRON] Expired lessons: ${resultOld.modifiedCount} (old), ${resultPassed.modifiedCount} (passed)`);

    } catch (error) {
      console.error("Lesson cleanup job error:", error);
    }
  });
};
