const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const admin = require("../fireBase/admin");
const { addPoints } = require("./pointsService");
const { _releasePaymentForLesson } = require("./paymentService"); 

const isSameId = (a, b) => a && b && a.toString() === b.toString();

exports.zegoCallback = asyncHandler(async (req, res) => {
  const { event, room_id, user_id, event_time } = req.body;

  console.log("Zego Event:", { event, room_id, user_id, event_time });

  if (!event || !room_id) {
    return res.status(400).json({ message: "Missing event or room_id" });
  }

  let lesson = await Lesson.findOne({ meetingRoomId: room_id })
    .populate("student", "firstName lastName email fcmToken preferredLang")
    .populate(
      "acceptedTeacher",
      "firstName lastName email fcmToken preferredLang teacherProfile.paymentInfo"
    );

  if (!lesson) {
    console.warn("Zego callback: lesson not found for room:", room_id);
    return res.status(200).json({ message: "No matching lesson for this room" });
  }

  const teacher = lesson.acceptedTeacher || null;
  const student = lesson.student || null;

  const zegoUserId = String(user_id || "").trim();
  const eventDate = event_time ? new Date(event_time * 1000) : new Date();

  if (!Array.isArray(lesson.activeParticipants)) {
    lesson.activeParticipants = [];
  }

  switch (event) {
    // ============================
    // 1️⃣ User Joined the Room
    // ============================
    case "RoomUserJoin": {
      if (!lesson.activeParticipants.includes(zegoUserId)) {
        lesson.activeParticipants.push(zegoUserId);
      }

      if (lesson.meetingStatus === "upcoming") {
        lesson.meetingStatus = "ongoing";
        lesson.meetingStartTime = eventDate;
      }

      await lesson.save();

      // First join → session started
      if (
        lesson.meetingStatus === "ongoing" &&
        lesson.activeParticipants.length === 1
      ) {
        await sendLessonNotification([teacher, student], {
          titleEn: "🎥 The lesson has started!",
          titleAr: "🎥 بدأت الحصة الآن!",
          bodyEn: "The online lesson is now live. Please join the room.",
          bodyAr: "بدأت الحصة الآن! يمكنك الانضمام إلى الغرفة.",
          type: "lesson_started",
          lessonId: lesson._id,
        });
      }

      break;
    }

    // ============================
    // 2️⃣ User Left the Room
    // ============================
    case "RoomUserLeave": {
      lesson.activeParticipants = lesson.activeParticipants.filter(
        (id) => id !== zegoUserId
      );

      const noOneLeft =
        lesson.activeParticipants.length === 0 &&
        lesson.meetingStatus !== "finished";

      if (noOneLeft) {
        lesson.meetingEndTime = eventDate;
        lesson.meetingStatus = "finished";

        // If lesson was approved → consider it completed now
        const wasApproved = lesson.status === "approved";
        if (wasApproved) {
          lesson.status = "completed";
        }

        await lesson.save();

        if (wasApproved && student?._id) {
          try {
            await addPoints(student._id, 20, "Lesson completed via Zego session");
          } catch (err) {
            console.error("[Points] Failed to add points after Zego end:", err.message);
          }
        }

        // ✅ If payment is already PAID → trigger payout automatically
        try {
          if (
            lesson.paymentStatus === "paid" &&
            teacher?.teacherProfile?.paymentInfo?.payoutRecipientId
          ) {
            console.log(
              `🔁 Auto payout triggered from Zego webhook for lesson ${lesson._id}`
            );
            await _releasePaymentForLesson(lesson);
          } else {
            console.log(
              `ℹ️ Lesson ${lesson._id} ended, but payment not ready for payout. paymentStatus=${lesson.paymentStatus}`
            );
          }
        } catch (payoutErr) {
          console.error(
            "[Payout][ZegoWebhook] Failed to release payment:",
            payoutErr.response?.data || payoutErr.message
          );
        }

        await sendLessonNotification([teacher, student], {
          titleEn: "✅ The lesson has ended",
          titleAr: "✅ انتهت الحصة",
          bodyEn: "The online lesson has finished successfully.",
          bodyAr: "انتهت الحصة بنجاح.",
          type: "lesson_ended",
          lessonId: lesson._id,
        });
      } else {
        await lesson.save();
      }

      break;
    }

    default:
      console.log("Unhandled Zego event:", event);
  }

  res.status(200).json({ message: "Callback received successfully" });
});

// ===============================
// Helper: Send Lesson Notifications
// ===============================
const sendLessonNotification = async (
  users,
  { titleEn, titleAr, bodyEn, bodyAr, type, lessonId }
) => {
  for (const user of users) {
    if (!user || !user._id || !user.fcmToken) continue;

    const lang = user.preferredLang || "en";
    const title = lang === "ar" ? titleAr : titleEn;
    const body = lang === "ar" ? bodyAr : bodyEn;

    const token = decryptToken(user.fcmToken);
    if (!token) continue;

    try {
      await admin.messaging().send({
        notification: { title, body },
        token,
        data: {
          type,
          lessonId: lessonId.toString(),
        },
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
