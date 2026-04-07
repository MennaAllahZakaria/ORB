const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");

const admin = require("../fireBase/admin");
const { addPoints } = require("./pointsService");
const { _releasePaymentForLesson } = require("./paymentService");
const { generateZegoToken } = require("../utils/zego");
const crypto = require("crypto");
const axios = require("axios");

const APP_ID = process.env.ZEGO_APP_ID;
const SERVER_SECRET = process.env.ZEGO_SERVER_SECRET;

async function getZegoUsers(roomId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString(36).substring(2, 15);

  //  signature generation
  const stringToSign = `Action=DescribeUserList&AppId=${APP_ID}&RoomId=${roomId}&Timestamp=${timestamp}&Nonce=${nonce}`;

  const signature = crypto
    .createHmac("sha256", SERVER_SECRET)
    .update(stringToSign)
    .digest("hex");

  try {
    const response = await axios.get("https://rtc-api.zego.im/", {
      params: {
        Action: "DescribeUserList",
        AppId: APP_ID,
        RoomId: roomId,
        Timestamp: timestamp,
        Nonce: nonce,
        Signature: signature,
      },
    });

    const users = response.data?.UserList || [];

    // رجعي array of userIds بس
    return users.map((u) => u.UserId);

  } catch (err) {
    console.error("[Zego API Error]", err.response?.data || err.message);
    return [];
  }
}

const isSameId = (a, b) => a && b && a.toString() === b.toString();

exports.createLessonMeeting = async ({
  lesson,
  studentId,
  teacherId,
  effectiveTimeInSeconds
}) => {

  const meetingRoomId = `lesson_${uuidv4()}`;

  const teacherToken = generateZegoToken(
    teacherId.toString(),
    meetingRoomId,
    effectiveTimeInSeconds
  );

  const studentToken = generateZegoToken(
    studentId.toString(),
    meetingRoomId,
    effectiveTimeInSeconds
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

  const lesson = await Lesson.findOne({ meetingRoomId: room_id })
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

  // تأكيد array
  if (!Array.isArray(lesson.activeParticipants)) {
    lesson.activeParticipants = [];
  }

  switch (event) {

    case "room_create":{
      console.log(`[Zego] Room created: ${room_id} for lesson ${lesson._id}`);

      // set start time مرة واحدة بس
      if (!lesson.meetingStartTime) {
        lesson.meetingStartTime = eventDate;
        lesson.meetingStatus = "ongoing";
      }
      await lesson.save();
      break;
    }

    case "room_close":{
      console.log(`[Zego] Room closed: ${room_id} for lesson ${lesson._id}`);
      lesson.meetingEndTime = eventDate;
      lesson.meetingStatus = "finished";
      await lesson.save();
      break;
    }

    /* ============================
       USER JOINED
    ============================ */
    case "room_login": {

      // add user (avoid duplicates)
      if (!lesson.activeParticipants.includes(zegoUserId)) {
        lesson.activeParticipants.push(zegoUserId);
      }

      // ensure unique
      lesson.activeParticipants = [...new Set(lesson.activeParticipants)];

      // set start time مرة واحدة بس
      if (!lesson.meetingStartTime) {
        lesson.meetingStartTime = eventDate;
        lesson.meetingStatus = "ongoing";
      }

      // notification مرة واحدة
      if (!lesson.startNotificationSent) {
        await sendLessonNotification([teacher, student], {
          titleEn: "🎥 The lesson has started!",
          titleAr: "🎥 بدأت الحصة الآن!",
          bodyEn: "The online lesson is now live. Please join.",
          bodyAr: "بدأت الحصة الآن! يمكنك الانضمام.",
          type: "lesson_started",
          lessonId: lesson._id,
        });

        lesson.startNotificationSent = true;
      }

      await lesson.save();
      break;
    }

    /* ============================
       USER LEFT
    ============================ */
    case "room_logout": {

      // =========================
      //لو user_id موجود
      // =========================
      if (zegoUserId) {
        lesson.activeParticipants = lesson.activeParticipants.filter(
          (id) => id !== zegoUserId
        );

        await lesson.save();
      }

      // =========================
      //  نتحقق من الغرفة بعد delay
      // =========================
      setTimeout(async () => {
        try {
          const freshLesson = await Lesson.findById(lesson._id);
          if (!freshLesson) return;

          //  نسأل Zego مباشرة
          const usersInRoom = await getZegoUsers(room_id);

          console.log("[Zego] real users:", usersInRoom);

          // sync الحالة
          freshLesson.activeParticipants = usersInRoom;

          // =========================
          //  لو الغرفة فاضية
          // =========================
          if (
            usersInRoom.length === 0 &&
            freshLesson.meetingStatus !== "finished"
          ) {
            freshLesson.meetingEndTime = new Date();
            freshLesson.meetingStatus = "finished";

            await freshLesson.save();

            console.log("[Zego] Lesson انتهت فعليًا");

            // 🎁 Points
            if (freshLesson.student?._id) {
              try {
                await addPoints(
                  freshLesson.student._id,
                  20,
                  "Lesson completed"
                );
              } catch (err) {
                console.error("[Points]", err.message);
              }
            }

            // 🔔 Notification
            if (!freshLesson.endNotificationSent) {
              await sendLessonNotification(
                [freshLesson.acceptedTeacher, freshLesson.student],
                {
                  titleEn: "✅ The lesson has ended",
                  titleAr: "✅ انتهت الحصة",
                  bodyEn: "The lesson has finished successfully.",
                  bodyAr: "انتهت الحصة بنجاح.",
                  type: "lesson_ended",
                  lessonId: freshLesson._id,
                }
              );

              freshLesson.endNotificationSent = true;
              await freshLesson.save();
            }
          } else {
            // 👇 لسه في ناس، update بس
            await freshLesson.save();
          }

        } catch (err) {
          console.error("[Zego][FINAL CHECK ERROR]", err.message);
        }
      }, 10000); // ⏱️ 10 ثواني كفاية بدل 30

      break;
    }

    /* ============================
       DEFAULT
    ============================ */
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
