const asyncHandler = require("express-async-handler");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");

const admin = require("../fireBase/admin");
const { addPoints } = require("./pointsService");
const { generateZegoToken } = require("../utils/zego");
const crypto = require("crypto");
const axios = require("axios");

const APP_ID = process.env.ZEGO_APP_ID;
const SERVER_SECRET = process.env.ZEGO_SERVER_SECRET;
const ZEGO_SIGNATURE_VERSION = "2.0";

/**
 * ZEGOCLOUD Server API v2 signature:
 * md5(AppId + SignatureNonce + ServerSecret + Timestamp)
 */
function generateZegoApiSignature({ appId, signatureNonce, timestamp }) {
  return crypto
    .createHash("md5")
    .update(`${appId}${signatureNonce}${SERVER_SECRET}${timestamp}`, "utf8")
    .digest("hex");
}

async function getZegoUsers(roomId) {
  if (!APP_ID || !SERVER_SECRET) {
    console.error("[Zego API Error] Missing ZEGO_APP_ID or ZEGO_SERVER_SECRET");
    return [];
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signatureNonce = crypto.randomBytes(8).toString("hex");
  const signature = generateZegoApiSignature({
    appId: APP_ID,
    signatureNonce,
    timestamp,
  });

  try {
    const response = await axios.get("https://rtc-api.zego.im/", {
      params: {
        Action: "DescribeUserList",
        AppId: APP_ID,
        RoomId: roomId,
        Timestamp: timestamp,
        Signature: signature,
        SignatureNonce: signatureNonce,
        SignatureVersion: ZEGO_SIGNATURE_VERSION,
        Mode: 0,
        Limit: 200,
        Marker: "",
      },
    });

    if (response.data?.Code !== 0) {
      console.error("[Zego API Error]", response.data);
      return [];
    }

    const users = response.data?.Data?.UserList || [];
    return users.map((user) => String(user.UserId || user.user_id || "").trim()).filter(Boolean);
  } catch (err) {
    console.error("[Zego API Error]", err.response?.data || err.message);
    return [];
  }
}

function decodeZegoValue(value) {
  if (typeof value !== "string") return value;

  let decoded = value;
  if (value.includes("%") || value.includes("+")) {
    try {
      decoded = decodeURIComponent(value.replace(/\+/g, "%20"));
    } catch (_) {
      console.warn("[Zego] Unable to URL-decode callback value; using the original value");
    }
  }

  try {
    return JSON.parse(decoded);
  } catch (_) {
    const formFields = new URLSearchParams(decoded);
    if ([...formFields.keys()].length > 0) {
      return Object.fromEntries(formFields.entries());
    }
    return decoded;
  }
}

function extractZegoCallback(body = {}) {
  const decodedBody = decodeZegoValue(body);
  const payload = decodeZegoValue(
    decodedBody?.data || decodedBody?.Data || decodedBody?.payload || decodedBody
  );
  const details = payload && typeof payload === "object" ? payload : {};

  return {
    event: decodedBody?.event || decodedBody?.Event || details.event || details.Event,
    roomId:
      decodedBody?.room_id ||
      decodedBody?.roomId ||
      decodedBody?.RoomId ||
      details.room_id ||
      details.roomId ||
      details.RoomId,
    // ZEGOCLOUD Server API callbacks identify the user as user_account.
    // Keep the older aliases because callback payload format may vary by product/version.
    userId:
      decodedBody?.user_account ||
      decodedBody?.userAccount ||
      decodedBody?.UserAccount ||
      decodedBody?.user_id ||
      decodedBody?.userId ||
      decodedBody?.UserId ||
      decodedBody?.user?.user_account ||
      decodedBody?.user?.userAccount ||
      decodedBody?.user?.user_id ||
      decodedBody?.user?.userId ||
      decodedBody?.user?.id ||
      details.user_account ||
      details.userAccount ||
      details.UserAccount ||
      details.user_id ||
      details.userId ||
      details.UserId ||
      details.user?.user_account ||
      details.user?.userAccount ||
      details.user?.user_id ||
      details.user?.userId ||
      details.user?.id,
    eventTime:
      decodedBody?.event_time ||
      decodedBody?.eventTime ||
      decodedBody?.timestamp ||
      details.event_time ||
      details.eventTime ||
      details.timestamp,
    bodyKeys: Object.keys(decodedBody || {}),
    payloadKeys: Object.keys(details || {}),
  };
}

const isSameId = (a, b) => a && b && a.toString() === b.toString();

exports.createLessonMeeting = async ({
  lesson,
  studentId,
  teacherId,
  effectiveTimeInSeconds
}) => {

  // ZEGOCLOUD room IDs may contain only letters, numbers, and underscores.
  const meetingRoomId = `lesson_${uuidv4().replace(/-/g, "_")}`;

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
  const {
    event,
    roomId: room_id,
    userId: user_id,
    eventTime: event_time,
    bodyKeys,
    payloadKeys,
  } = extractZegoCallback(req.body);

  console.log("[Zego] Event:", {
    event,
    room_id,
    user_id: user_id ? String(user_id) : undefined,
  });

  if (!event || !room_id) {
    console.warn("[Zego] Callback missing required fields", { bodyKeys, payloadKeys });
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

  /* ===========================
     CONSTANTS
  ============================ */
  // Wait briefly for Zego's room user list to settle after a logout.
  // A room that is empty then moves to the completion-review flow, even
  // when the session was short; funds are still not released automatically.
  const FINAL_CHECK_DELAY = 15000; // 15 seconds

  switch (event) {
    /* ===========================
       ROOM LIFECYCLE EVENTS
       These callbacks describe the room itself; Zego does not attach a user account.
    ============================ */
    case "room_create": {
      console.log("[Zego] Room created:", room_id);
      break;
    }

    case "room_close": {
      console.log("[Zego] Room closed:", room_id);
      break;
    }

    /* ===========================
       USER JOINED
    ============================ */
    case "room_login": {

      if (zegoUserId && !lesson.activeParticipants.includes(zegoUserId)) {
        lesson.activeParticipants.push(zegoUserId);
      }

      lesson.activeParticipants = [...new Set(lesson.activeParticipants)];

      lesson.lastActiveAt = new Date();

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

    /* ===========================
       USER LEFT
    ============================ */
    case "room_logout": {

      // لو user معروف
      if (zegoUserId) {
        lesson.activeParticipants = lesson.activeParticipants.filter(
          (id) => id !== zegoUserId
        );

        lesson.lastActiveAt = new Date();

        await lesson.save();
      }

      // =========================
      // Final Check بعد delay
      // =========================
      setTimeout(async () => {
        try {
          const freshLesson = await Lesson.findById(lesson._id);
          if (!freshLesson) return;

          //get users from Zego API to confirm.
          const usersInRoom = await getZegoUsers(room_id);

          freshLesson.activeParticipants = usersInRoom;

          const now = new Date();

          const isEmpty = usersInRoom.length === 0;

          const shouldEnd =
            isEmpty &&
            freshLesson.meetingStartTime &&
            freshLesson.meetingStatus !== "finished";

          if (shouldEnd) {
            console.log("[Zego] Ending lesson and awaiting both completion responses");

            freshLesson.meetingEndTime = now;
            freshLesson.meetingStatus = "finished";

            // Zego confirms that the room ended, not that both parties agree
            // the lesson was completed. Keep the lesson available for the
            // completion/review flow; only that flow may mark it completed
            // or problematic and release funds.
            freshLesson.finalCompletionStatus = "pending";
            freshLesson.reviewStatus = "waiting_second_party";
            freshLesson.disputeFlag = false;

            await freshLesson.save();

            /* ===========================
               🔔 REQUEST COMPLETION REVIEW
            ============================ */
            if (!freshLesson.endNotificationSent) {
              await sendLessonNotification(
                [freshLesson.acceptedTeacher, freshLesson.student],
                {
                  titleEn: "📝 Confirm your lesson outcome",
                  titleAr: "📝 أكّد نتيجة الحصة",
                  bodyEn: "The meeting ended. Please confirm completion or report a problem.",
                  bodyAr: "انتهى الاجتماع. أكّد إتمام الحصة أو أبلغ عن مشكلة.",
                  type: "lesson_completion_required",
                  lessonId: freshLesson._id,
                }
              );

              freshLesson.endNotificationSent = true;
              await freshLesson.save();
            }

          } else {
            // لسه في احتمال يرجعوا
            await freshLesson.save();
          }

        } catch (err) {
          console.error("[Zego][SAFE END ERROR]", err.message);
        }
      }, FINAL_CHECK_DELAY);

      break;
    }

    /* ===========================
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
        if (err.message.includes("messaging/registration-token-not-registered") || err.message.includes("messaging/invalid-registration-token")) {
          console.error("Invalid FCM token for user:", user.email);
          await User.findByIdAndUpdate(user._id, { fcmToken: null });
        }
    }
  }
};
