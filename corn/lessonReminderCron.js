const cron = require("node-cron");
const Lesson = require("../models/lessonModel");
const admin = require("../fireBase/admin");
const User = require("../models/userModel");
const { decryptToken } = require("../utils/fcmToken");

exports.startLessonReminderCron = () => {

  /* =========================================
     RUN EVERY 5 MINUTES
  ========================================= */
  cron.schedule("*/5 * * * *", async () => {
    console.log("Running lesson reminder cron...");

    const now = new Date();

    try {

      const lessons = await Lesson.find({
        status: "approved",
        meetingStatus: "upcoming"
      }).populate("student acceptedTeacher");

      for (let lesson of lessons) {

        const lessonDate = new Date(lesson.requestedDate);
        const diffMinutes = (lessonDate - now) / 1000 / 60;

        /* =============================
           MORNING REMINDER (8 AM SAME DAY)
        ============================== */
        const sameDay =
          lessonDate.getDate() === now.getDate() &&
          lessonDate.getMonth() === now.getMonth() &&
          lessonDate.getFullYear() === now.getFullYear();

        const isMorning = now.getHours() === 8;

        if (
          sameDay &&
          isMorning &&
          !lesson.morningReminderSent
        ) {

          await sendReminder(lesson, "morning");

          lesson.morningReminderSent = true;
          await lesson.save();
        }

        /* =============================
           30 MINUTES REMINDER
        ============================== */
        if (
          diffMinutes <= 30 &&
          diffMinutes > 0 &&
          !lesson.halfHourReminderSent
        ) {

          await sendReminder(lesson, "halfHour");

          lesson.halfHourReminderSent = true;
          await lesson.save();
        }

      }

    } catch (err) {
      console.error("Cron error:", err);
    }

  });

};


/* =========================================
   SEND NOTIFICATION FUNCTION
========================================= */
async function sendReminder(lesson, type) {

  const users = [lesson.student, lesson.acceptedTeacher];

  for (let user of users) {

    if (!user?.fcmToken) continue;

    const token = decryptToken(user.fcmToken);
    if (!token) continue;

    const isArabic = user.preferredLang === "ar";

    let title;
    let body;

    if (type === "morning") {
      title = isArabic ? "📅 عندك حصة النهاردة" : "📅 You have a lesson today";
      body = isArabic
        ? `حصتك في مادة ${lesson.subject} النهاردة`
        : `Your ${lesson.subject} lesson is today`;
    } else {
      title = isArabic ? "⏰ الحصة بعد 30 دقيقة" : "⏰ Lesson in 30 minutes";
      body = isArabic
        ? `حصتك في مادة ${lesson.subject} بعد نص ساعة`
        : `Your ${lesson.subject} lesson starts in 30 minutes`;
    }

    try {
      await admin.messaging().send({
        notification: { title, body },
        token
      });
    } catch (err) {
      console.error("Reminder send error:", err);
    }
  }
}
