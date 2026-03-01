const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");

const admin = require("../fireBase/admin");
const { addPoints } = require("./pointsService");
const { _releasePaymentForLesson } = require("./paymentService");
const { generateZegoToken } = require("../utils/zego");


const isSameId = (a, b) => a && b && a.toString() === b.toString();

exports.createLessonMeeting = async ({
  lesson,
  studentId,
  teacherId
}) => {

  const meetingRoomId = `lesson_${uuidv4()}`;

  const teacherToken = generateZegoToken(
    teacherId.toString(),
    meetingRoomId
  );

  const studentToken = generateZegoToken(
    studentId.toString(),
    meetingRoomId
  );

  lesson.meetingRoomId = meetingRoomId;
  lesson.zegoTokenForStudent = studentToken;
  lesson.zegoTokenForTeacher = teacherToken;
  lesson.meetingStatus = "upcoming";

  await lesson.save();

  return {
    meetingRoomId,
    studentToken,
    teacherToken
  };
};

exports.zegoCallback = asyncHandler(async (req, res) => {
  const { event, room_id, user_id, event_time } = req.body;

  console.log("[Zego] Event:", { event, room_id, user_id });

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
    console.warn("[Zego] No lesson for room:", room_id);
    return res.status(200).json({ message: "No matching lesson" });
  }

  const teacher = lesson.acceptedTeacher;
  const student = lesson.student;

  const zegoUserId = String(user_id || "").trim();
  const eventDate = event_time ? new Date(event_time * 1000) : new Date();

  if (!Array.isArray(lesson.activeParticipants)) {
    lesson.activeParticipants = [];
  }

  switch (event) {
    /* ============================
       1️⃣ USER JOINED
    ============================ */
    case "RoomUserJoin": {
      if (!lesson.activeParticipants.includes(zegoUserId)) {
        lesson.activeParticipants.push(zegoUserId);
      }

      if (lesson.meetingStatus === "upcoming") {
        lesson.meetingStatus = "ongoing";
        lesson.meetingStartTime = eventDate;
      }

      await lesson.save();

      // First participant joined → notify
      if (
        lesson.meetingStatus === "ongoing" &&
        lesson.activeParticipants.length === 1
      ) {
        await sendLessonNotification([teacher, student], {
          titleEn: "🎥 The lesson has started!",
          titleAr: "🎥 بدأت الحصة الآن!",
          bodyEn: "The online lesson is now live. Please join.",
          bodyAr: "بدأت الحصة الآن! يمكنك الانضمام.",
          type: "lesson_started",
          lessonId: lesson._id,
        });
      }
      break;
    }

    /* ============================
       2️⃣ USER LEFT
    ============================ */
    case "RoomUserLeave": {
      lesson.activeParticipants = lesson.activeParticipants.filter(
        (id) => id !== zegoUserId
      );

      const roomEmpty =
        lesson.activeParticipants.length === 0 &&
        lesson.meetingStatus !== "finished";

      if (!roomEmpty) {
        await lesson.save();
        break;
      }

      // Room ended
      lesson.meetingEndTime = eventDate;
      lesson.meetingStatus = "finished";

      const wasApproved = lesson.status === "approved";
      if (wasApproved) {
        lesson.status = "completed";
      }

      await lesson.save();

      // 🎁 Student points
      if (wasApproved && student?._id) {
        try {
          await addPoints(student._id, 20, "Lesson completed");
        } catch (err) {
          console.error("[Points][Zego]", err.message);
        }
      }

      /* ============================
         💸 AUTO PAYOUT (SAFE)
      ============================ */
      try {
        if (
          lesson.status === "completed" &&
          lesson.paymentStatus === "paid" &&
          lesson.paymentStatus !== "released"
        ) {
          console.log(
            `[Zego] Auto payout triggered for lesson ${lesson._id}`
          );
          await _releasePaymentForLesson(lesson);
        }
      } catch (err) {
        console.error(
          "[Payout][Zego] Failed:",
          err.response?.data || err.message
        );
      }

      await sendLessonNotification([teacher, student], {
        titleEn: "✅ The lesson has ended",
        titleAr: "✅ انتهت الحصة",
        bodyEn: "The lesson has finished successfully.",
        bodyAr: "انتهت الحصة بنجاح.",
        type: "lesson_ended",
        lessonId: lesson._id,
      });

      break;
    }

    default:
      console.log("[Zego] Unhandled event:", event);
  }

  res.status(200).json({ message: "Callback handled" });
});

/* =====================================================
   NOTIFICATION HELPER
===================================================== */

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
        token,
        notification: { title, body },
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
      console.error("[FCM] Failed:", err.message);
    }
  }
};
