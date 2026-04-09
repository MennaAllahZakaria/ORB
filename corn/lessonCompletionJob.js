const cron = require("node-cron");
const Lesson = require("../models/lessonModel");
const LESSON_DURATION_BUFFER = 5 * 60 * 1000; // 5 دقايق

exports.runLessonCompletionJob = () => {
    // runs every minute
  cron.schedule("*/1 * * * *", async () => {
    console.log("[CRON] Checking lessons...");

    try {

      const now = new Date();

      // نجيب الحصص اللي شغالة
      const lessons = await Lesson.find({
        meetingStatus: "ongoing",
        meetingStartTime: { $ne: null },
      });

      for (const lesson of lessons) {

        // لازم يكونوا دخلوا
        if (!lesson.activeParticipants || lesson.activeParticipants.length < 2) {
          continue;
        }

        const startTime = new Date(lesson.meetingStartTime);

        const durationMs = (lesson.durationInMinutes || 60) * 60 * 1000;

        const expectedEndTime = new Date(startTime.getTime() + durationMs);

        const shouldEnd =
          now > new Date(expectedEndTime.getTime() + LESSON_DURATION_BUFFER);

        if (!shouldEnd) continue;

        // =========================
        // END LESSON
        // =========================
        console.log(`[CRON] Auto completing lesson ${lesson._id}`);

        lesson.meetingEndTime = now;
        lesson.meetingStatus = "finished";

        // 👇 أهم سطر
        lesson.finalCompletionStatus = "completed";

        await lesson.save();

        // 🎁 Points
        if (lesson.student) {
          try {
            await addPoints(lesson.student, 20, "Lesson completed");
          } catch (err) {
            console.error("[CRON Points]", err.message);
          }
        }

        // 🔔 Notification
        if (!lesson.endNotificationSent) {
          await sendLessonNotification(
            [lesson.acceptedTeacher, lesson.student],
            {
              titleEn: "✅ Lesson completed automatically",
              titleAr: "✅ تم إنهاء الحصة تلقائيًا",
              bodyEn: "The lesson has been marked as completed.",
              bodyAr: "تم إنهاء الحصة تلقائيًا.",
              type: "lesson_ended",
              lessonId: lesson._id,
            }
          );

          lesson.endNotificationSent = true;
          await lesson.save();
        }

      }

    } catch (err) {
      console.error("[CRON ERROR]", err.message);
    }
  });
};