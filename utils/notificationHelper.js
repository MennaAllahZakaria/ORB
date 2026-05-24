const admin = require("../fireBase/admin");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("./fcmToken");
const sendEmail = require("./sendEmail");

/**
 * Generic function to send notification via FCM and save to DB
 */
exports.sendNotification = async ({
  recipient,
  senderId = null,
  titleEn,
  titleAr,
  bodyEn,
  bodyAr,
  data = {},
  saveToDb = true,
  sendEmailIfNoToken = true
}) => {
  try {
    if (!recipient) return;

    const lang = recipient.preferredLang || "en";
    const title = lang === "ar" ? titleAr : titleEn;
    const body = lang === "ar" ? bodyAr : bodyEn;

    let sentViaFcm = false;

    if (recipient.fcmToken) {
      const token = decryptToken(recipient.fcmToken);
      if (token) {
        try {
          await admin.messaging().send({
            token,
            notification: { title, body },
            data: {
              ...data,
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            },
          });
          sentViaFcm = true;
        } catch (fcmErr) {
          console.error("[FCM] Send error:", fcmErr.message);
        }
      }
    }

    if (!sentViaFcm && sendEmailIfNoToken && recipient.email) {
      try {
        await sendEmail({
          Email: recipient.email,
          subject: title,
          message: body,
        });
      } catch (emailErr) {
        console.error("[Email] Send error:", emailErr.message);
      }
    }

    if (saveToDb) {
      await Notification.create({
        recipient: recipient._id,
        sendBy: senderId,
        title,
        message: body,
        type: data.type || "general",
        referenceId: data.lessonId || data.payoutId || null
      });
    }

    return true;
  } catch (err) {
    console.error("[NotificationHelper] Error:", err.message);
    return false;
  }
};
