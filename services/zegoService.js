const ApiError = require("../utils/apiError");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const admin = require("../fireBase/admin");


exports.zegoCallback = asyncHandler(async (req, res) => {
  const { event, room_id, user_id, event_time } = req.body;

  console.log("Zego Event:", event, "Room:", room_id, "User:", user_id);

  const lesson = await Lesson.findOne({ roomId: room_id });
  if (!lesson) return res.status(404).json({ message: "Lesson not found" });

  const teacher = await User.findById(lesson.teacher);
  const student = await User.findById(lesson.student);

  switch (event) {
    case "RoomUserJoin":
      if (lesson.status === "approved") {
        lesson.status = "accepted";
        lesson.startedAt = new Date(event_time * 1000);
        await lesson.save();

        // === إشعار البداية ===
        await sendLessonNotification(
          [teacher, student],
          "🎥 The lesson has started!",
          "The online lesson is now live. Please join the room.",
          "بدأت الحصة الآن! يمكنك الانضمام إلى الغرفة.",
          "lesson_started",
          lesson._id
        );
      }
      break;

    case "RoomUserLeave":

    if (!lesson.endedAt) {
        lesson.status = "finished";
        lesson.endedAt = new Date(event_time * 1000);
        await lesson.save();

        // === end notification ===
        await sendLessonNotification(
          [teacher, student],
          "✅ The lesson has ended",
          "The online lesson has finished successfully.",
          "انتهت الحصة بنجاح.",
          "lesson_ended",
          lesson._id
        );
      }
      break;

    default:
      console.log("Unhandled event:", event);
  }

  res.status(200).json({ message: "Callback received successfully" });
});

const sendLessonNotification = async (users, titleEn, bodyEn, bodyAr, type, lessonId) => {
  for (const user of users) {
    if (!user?.fcmToken) continue;

    const lang = user.preferredLang || "en";
    const title = lang === "ar" ? titleEn.replace("The", "بدأت") : titleEn;
    const body = lang === "ar" ? bodyAr : bodyEn;

    const token = decryptToken(user.fcmToken);
    if (!token) continue;

    try {
      await admin.messaging().send({
        notification: { title, body },
        token,
        data: { type, lessonId: lessonId.toString() },
      });

      await Notification.create({
        sendBy: null,
        recipient: user._id,
        title,
        message: body,
      });
    } catch (err) {
      console.error("Error sending FCM:", err);
    }
  }
};
