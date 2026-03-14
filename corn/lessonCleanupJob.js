const cron = require("node-cron");
const Lesson = require("../models/lessonModel");

const runLessonCleanupJob = async () => {

    try {

      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      await Lesson.updateMany(
        {
            status: "pending",
            acceptedTeacher: null,
            createdAt: { $lt: twoDaysAgo }
        },
        {
            status: "expired"
        }
        );

      console.log(`Expired lessons updated: ${result.modifiedCount}`);

    } catch (error) {

      console.error("Lesson cleanup job error:", error);

    }

  };


module.exports = runLessonCleanupJob;