const asyncHandler = require("express-async-handler");
const axios = require("axios");
const crypto = require("crypto");

const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const admin = require("../fireBase/admin");

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_USER_ID = process.env.ZOOM_USER_ID || "me";
const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

let accessTokenCache = null;

const isConfigured = () =>
  Boolean(
    ZOOM_ACCOUNT_ID &&
      ZOOM_CLIENT_ID &&
      ZOOM_CLIENT_SECRET &&
      ZOOM_USER_ID
  );

const zoomConfigError = () =>
  new Error(
    "Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET and ZOOM_USER_ID."
  );

async function getZoomAccessToken() {
  if (!isConfigured()) throw zoomConfigError();

  if (
    accessTokenCache &&
    accessTokenCache.expiresAt > Date.now() + 60 * 1000
  ) {
    return accessTokenCache.value;
  }

  const basicCredentials = Buffer.from(
    `${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    ZOOM_TOKEN_URL,
    new URLSearchParams({
      grant_type: "account_credentials",
      account_id: ZOOM_ACCOUNT_ID,
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    }
  );

  accessTokenCache = {
    value: response.data.access_token,
    expiresAt: Date.now() + Number(response.data.expires_in || 3600) * 1000,
  };

  return accessTokenCache.value;
}

async function zoomRequest(config) {
  const token = await getZoomAccessToken();

  try {
    return await axios({
      ...config,
      baseURL: ZOOM_API_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      timeout: 20000,
    });
  } catch (error) {
    if (error.response?.status === 401) {
      accessTokenCache = null;
      const retryToken = await getZoomAccessToken();
      return axios({
        ...config,
        baseURL: ZOOM_API_BASE,
        headers: {
          Authorization: `Bearer ${retryToken}`,
          "Content-Type": "application/json",
          ...(config.headers || {}),
        },
        timeout: 20000,
      });
    }

    throw error;
  }
}

function getScheduledStartTime(lesson) {
  const requestedDate = new Date(lesson.requestedDate);
  const now = new Date();

  // Zoom does not accept a scheduled start in the past. Urgent lessons can
  // still be created immediately without changing the lesson's own schedule.
  return requestedDate > now ? requestedDate : now;
}

async function createZoomLessonMeeting({ lesson }) {
  const response = await zoomRequest({
    method: "post",
    url: `/users/${encodeURIComponent(ZOOM_USER_ID)}/meetings`,
    data: {
      topic: lesson.title || `ORB lesson ${lesson._id}`,
      type: 2,
      start_time: getScheduledStartTime(lesson).toISOString(),
      duration: Math.max(1, Number(lesson.durationInMinutes || 60)),
      timezone: process.env.ZOOM_TIMEZONE || "Africa/Cairo",
      password: crypto.randomBytes(6).toString("hex"),
      settings: {
        waiting_room: false,
        join_before_host: false,
        mute_upon_entry: true,
        participant_video: true,
        host_video: true,
        auto_recording: "none",
      },
    },
  });

  const meeting = response.data;

  lesson.meetingProvider = "zoom";
  lesson.zoomMeetingId = String(meeting.id);
  lesson.zoomJoinUrl = meeting.join_url || null;
  lesson.zoomStartUrl = meeting.start_url || null;
  lesson.zoomPassword = meeting.password || null;
  // Keep the old field populated with the Zoom meeting number for clients that
  // still display meetingRoomId, while tokens remain null and unused.
  lesson.meetingRoomId = String(meeting.id);
  lesson.zegoTokenForStudent = null;
  lesson.zegoTokenForTeacher = null;
  lesson.meetingStatus = "upcoming";

  await lesson.save();

  return {
    provider: "zoom",
    meetingId: String(meeting.id),
    meetingRoomId: String(meeting.id),
    joinUrl: meeting.join_url,
    startUrl: meeting.start_url,
    password: meeting.password || null,
  };
}

function getMeetingId(payload = {}) {
  const object = payload.object || payload.meeting || {};
  return String(object.id || object.meeting_id || payload.meeting_id || "").trim();
}

function getParticipantId(payload = {}) {
  const participant = payload.object?.participant || payload.participant || {};
  return String(
    participant.user_id ||
      participant.id ||
      participant.email ||
      participant.user_name ||
      ""
  ).trim();
}

async function notifyLessonUsers(lesson, content) {
  const users = [lesson.acceptedTeacher, lesson.student].filter(Boolean);

  for (const user of users) {
    if (!user._id || !user.fcmToken) continue;

    const lang = user.preferredLang || "en";
    const title = lang === "ar" ? content.titleAr : content.titleEn;
    const body = lang === "ar" ? content.bodyAr : content.bodyEn;
    const token = decryptToken(user.fcmToken);
    if (!token) continue;

    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data: {
          type: content.type,
          lessonId: lesson._id.toString(),
        },
      });

      await Notification.create({
        sendBy: null,
        recipient: user._id,
        title,
        message: body,
      });
    } catch (error) {
      console.error("[Zoom][FCM] Failed:", error.message);
    }
  }
}

async function handleZoomEvent(payload = {}) {
  const event = payload.event;
  const meetingId = getMeetingId(payload);
  if (!event || !meetingId) return;

  const lesson = await Lesson.findOne({
    $or: [
      { zoomMeetingId: meetingId },
      { meetingRoomId: meetingId, meetingProvider: "zoom" },
    ],
  }).populate("student acceptedTeacher");

  if (!lesson) {
    console.warn("[Zoom] No lesson for meeting:", meetingId);
    return;
  }

  const eventObject = payload.object || {};
  const eventDate = payload.event_ts
    ? new Date(Number(payload.event_ts))
    : eventObject.start_time || eventObject.end_time
      ? new Date(eventObject.start_time || eventObject.end_time)
      : new Date();

  if (!Array.isArray(lesson.activeParticipants)) {
    lesson.activeParticipants = [];
  }

  switch (event) {
    case "meeting.started":
      lesson.meetingProvider = "zoom";
      lesson.meetingStatus = "ongoing";
      lesson.meetingStartTime = lesson.meetingStartTime || eventDate;
      lesson.lastActiveAt = new Date();

      if (!lesson.startNotificationSent) {
        await notifyLessonUsers(lesson, {
          titleEn: "The lesson has started!",
          titleAr: "بدأت الحصة الآن!",
          bodyEn: "The Zoom lesson is now live. Please join.",
          bodyAr: "بدأت الحصة على Zoom الآن! يمكنك الانضمام.",
          type: "lesson_started",
        });
        lesson.startNotificationSent = true;
      }
      break;

    case "meeting.participant_joined": {
      const participantId = getParticipantId(payload);
      if (participantId && !lesson.activeParticipants.includes(participantId)) {
        lesson.activeParticipants.push(participantId);
      }
      lesson.lastActiveAt = new Date();
      if (!lesson.meetingStartTime) {
        lesson.meetingStartTime = new Date();
        lesson.meetingStatus = "ongoing";
      }
      break;
    }

    case "meeting.participant_left": {
      const participantId = getParticipantId(payload);
      if (participantId) {
        lesson.activeParticipants = lesson.activeParticipants.filter(
          (id) => id !== participantId
        );
      }
      lesson.lastActiveAt = new Date();
      break;
    }

    case "meeting.ended":
      lesson.meetingStatus = "finished";
      lesson.meetingEndTime = eventDate;
      lesson.finalCompletionStatus = "completed";
      lesson.reviewStatus = "waiting_second_party";
      lesson.disputeFlag = false;
      lesson.activeParticipants = [];

      if (!lesson.endNotificationSent) {
        await notifyLessonUsers(lesson, {
          titleEn: "Confirm your lesson outcome",
          titleAr: "أكّد نتيجة الحصة",
          bodyEn:
            "The Zoom meeting ended. Please confirm completion or report a problem.",
          bodyAr: "انتهت حصة Zoom. أكّد إتمام الحصة أو أبلغ عن مشكلة.",
          type: "lesson_completion_required",
        });
        lesson.endNotificationSent = true;
      }
      break;

    default:
      return;
  }

  await lesson.save();
}

function validateWebhookRequest(req) {
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) return true;

  const timestamp = req.headers["x-zm-request-timestamp"];
  const signature = req.headers["x-zm-signature"];
  if (!timestamp || !signature) return false;

  const rawBody = req.rawBody?.toString("utf8") || JSON.stringify(req.body);
  const message = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto
    .createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest("hex")}`;

  if (signature.length !== expected.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

exports.createZoomLessonMeeting = createZoomLessonMeeting;
exports.zoomWebhook = asyncHandler(async (req, res) => {
  const body = req.body || {};

  if (body.event === "endpoint.url_validation") {
    const plainToken = body.payload?.plainToken;
    if (!plainToken || !ZOOM_WEBHOOK_SECRET_TOKEN) {
      return res.status(400).json({ message: "Zoom webhook validation is not configured" });
    }

    const encryptedToken = crypto
      .createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  if (!validateWebhookRequest(req)) {
    return res.status(401).json({ message: "Invalid Zoom webhook signature" });
  }

  await handleZoomEvent(body);
  return res.status(200).json({ received: true });
});

exports.handleZoomEvent = handleZoomEvent;
exports.getZoomAccessToken = getZoomAccessToken;
