const admin = require("../fireBase/admin");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");

exports.sendNegotiationNotification = async ({
  lesson,
  sender,
  receiver,
  price
}) => {
  try {
    if (!receiver?.fcmToken || receiver.fcmToken === null) return;

    const token = decryptToken(receiver.fcmToken);
    if (!token) return;

    const isArabic = receiver.preferredLang === "ar";

    const title = isArabic
      ? "💬 عرض سعر جديد"
      : "💬 New Price Offer";

    const body = isArabic
      ? `${sender.firstName} اقترح سعر ${price} جنيه على الدرس`
      : `${sender.firstName} proposed ${price} EGP for your lesson`;

    await admin.messaging().send({
      notification: { title, body },
      token,
      data: {
        type: "negotiation",
        lessonId: lesson._id.toString()
      }
    });

    await Notification.create({
      sendBy: sender._id,
      recipient: receiver._id,
      title,
      message: body
    });

  } catch (err) {
    console.error("Notification error:", err);
  }
};
