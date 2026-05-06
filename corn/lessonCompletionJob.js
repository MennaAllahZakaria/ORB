const cron = require("node-cron");
const Lesson = require("../models/lessonModel");
const { addPoints } = require("../services/pointsService");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const admin = require("../fireBase/admin");

const LESSON_DURATION_BUFFER = 5 * 60 * 1000; // 5 دقايق

const sendLessonNotification = async (users, { titleEn, titleAr, bodyEn, bodyAr, type, lessonId }) => {
  for (const user of users) {
    if (!user || !user._id || !user.fcmToken) continue;
    const lang = user.preferredLang || "en";
    const title = lang === "ar" ? titleAr : titleEn;
    const body = lang === "ar" ? bodyAr : bodyEn;
    const token = decryptToken(user.fcmToken);
    if (!token) continue;
    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data: { type, lessonId: lessonId.toString() },
      });
      await Notification.create({
        sendBy: null,
        recipient: user._id,
        title,
        message: body,
      });
    } catch (err) {
      console.error("[FCM] Failed:", err.message);
    }
  }
};

exports.runLessonCompletionJob = () => {
  cron.schedule("*/15 * * * *", async () => {
    console.log("[CRON] Checking lessons...");
    try {
      const now = new Date();

      // 1. Handle Ongoing Lessons
      const ongoingLessons = await Lesson.find({
        meetingStatus: "ongoing",
        meetingStartTime: { $ne: null },
      }).populate("student acceptedTeacher");

      for (const lesson of ongoingLessons) {
        if (!lesson.activeParticipants || lesson.activeParticipants.length < 2) continue;
        const startTime = new Date(lesson.meetingStartTime);
        const durationMs = (lesson.durationInMinutes || 60) * 60 * 1000;
        const expectedEndTime = new Date(startTime.getTime() + durationMs);
        if (now <= new Date(expectedEndTime.getTime() + LESSON_DURATION_BUFFER)) continue;

        console.log(`[CRON] Auto completing ongoing lesson ${lesson._id}`);
        lesson.meetingEndTime = now;
        lesson.meetingStatus = "finished";
        lesson.finalCompletionStatus = "completed";
        await lesson.save();

        if (lesson.student?._id) {
          try { await addPoints(lesson.student._id, 20, "Lesson completed"); }
          catch (err) { console.error("[CRON Points]", err.message); }
        }

        if (!lesson.endNotificationSent) {
          await sendLessonNotification([lesson.acceptedTeacher, lesson.student], {
            titleEn: "✅ Lesson completed automatically",
            titleAr: "✅ تم إنهاء الحصة تلقائيًا",
            bodyEn: "The lesson has been marked as completed.",
            bodyAr: "تم إنهاء الحصة تلقائيًا.",
            type: "lesson_ended",
            lessonId: lesson._id,
          });
          lesson.endNotificationSent = true;
          await lesson.save();
        }
      }

      // 2. Handle Missed/Upcoming Lessons (Approved but never started)
      const missedLessons = await Lesson.find({
        status: "approved",
        meetingStatus: "upcoming",
        meetingStartTime: null
      }).populate("student acceptedTeacher");

      for (const lesson of missedLessons) {
        const durationMs = (lesson.durationInMinutes || 60) * 60 * 1000;
        const expectedEndTime = new Date(lesson.requestedDate.getTime() + durationMs);
        if (now <= new Date(expectedEndTime.getTime() + LESSON_DURATION_BUFFER)) continue;

        console.log(`[CRON] Marking missed lesson ${lesson._id} as problem`);
        lesson.meetingStatus = "finished";
        lesson.finalCompletionStatus = "incomplete";
        lesson.reviewStatus = "disputed";
        lesson.disputeFlag = true;
        await lesson.save();

        await sendLessonNotification([lesson.acceptedTeacher, lesson.student], {
          titleEn: "⚠️ Lesson missed",
          titleAr: "⚠️ لم يتم حضور الحصة",
          bodyEn: "The lesson time has passed without being started. It has been marked for review.",
          bodyAr: "لقد مر وقت الحصة دون أن تبدأ. تم تحويلها للمراجعة.",
          type: "lesson_problem",
          lessonId: lesson._id,
        });
      }

    } catch (err) {
      console.error("[CRON ERROR]", err.message);
    }
  });
};