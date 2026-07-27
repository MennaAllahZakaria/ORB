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

    const next35Minutes = new Date(now.getTime() + 35 * 60 * 1000);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    try {

      const lessons = await Lesson.find({
        status: "approved",
        meetingStatus: "upcoming",
        $or: [
          {
            halfHourReminderSent: false,
            requestedDate: {
              $gte: now,
              $lte: next35Minutes
            }
          },
          {
            morningReminderSent: false,
            requestedDate: {
              $gte: startOfToday,
              $lte: endOfToday
            }
          }
        ]
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

        const isMorning = now.getHours() === 8 && now.getMinutes() < 5;

        if (
          sameDay &&
          isMorning &&
          !lesson.morningReminderSent
        ) {

          await sendReminder(lesson, "morning");

          await Lesson.updateOne(
              { _id: lesson._id },
              {
                  morningReminderSent: true
              }
          );
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

          await Lesson.updateOne(
              { _id: lesson._id },
              {
                  halfHourReminderSent: true
              }
          );
        }

      }

    } catch (err) {
      console.error("Cron error:", err);
    }

  } ,{
    timezone: "Africa/Cairo",
  }
);

};


/* =========================================
   SEND NOTIFICATION FUNCTION
========================================= */
async function sendReminder(lesson, type) {

    const users = [lesson.student];

    if (lesson.acceptedTeacher) {
      users.push(lesson.acceptedTeacher);
    }
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
        token,

        notification: {
          title,
          body,
        },

        data: {
          type: "lesson_reminder",
          lessonId: lesson._id.toString(),
          reminderType: type,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      });
    } catch (err) {
      console.error("Reminder send error:", err);
        const code = err.errorInfo?.code || err.code;
        if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
        ) {

            await User.findByIdAndUpdate(
                user._id,
                {
                    $unset: {
                        fcmToken: 1
                    }
                }
            );

        }
    }
  }
}
