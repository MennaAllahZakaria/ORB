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

      lesson.activeParticipants = lesson.activeParticipants.filter(
        (id) => id !== zegoUserId
      );

      await lesson.save();

      // لو الغرفة فاضية → نستنى شوية (anti race condition)
      if (lesson.activeParticipants.length === 0) {

        setTimeout(async () => {
          const freshLesson = await Lesson.findById(lesson._id);

          if (!freshLesson) return;

          // لو لسه فاضية
          if (
            freshLesson.activeParticipants.length === 0 &&
            freshLesson.meetingStatus !== "finished"
          ) {

            freshLesson.meetingEndTime = new Date();
            freshLesson.meetingStatus = "finished";

            await freshLesson.save();

            /* ============================
               🎁 Points
            ============================ */
            if (freshLesson.student?._id) {
              try {
                await addPoints(freshLesson.student._id, 20, "Lesson completed");
              } catch (err) {
                console.error("[Points][Zego]", err.message);
              }
            }

            /* ============================
               💸 AUTO PAYOUT
            ============================ */
            try {
              if (freshLesson.paymentStatus === "paid") {
                console.log(`[Zego] Auto payout for lesson ${freshLesson._id}`);

                // await _releasePaymentForLesson(freshLesson);

                freshLesson.paymentStatus = "released";
                await freshLesson.save();
              }
            } catch (err) {
              console.error(
                "[Payout][Zego]",
                err.response?.data || err.message
              );
            }

            /* ============================
               Notification
            ============================ */
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
          }

        }, 30000); //  30 ثانية buffer
      }

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
