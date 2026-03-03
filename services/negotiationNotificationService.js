const admin = require("../fireBase/admin");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const sendEmail = require("../utils/sendEmail"); 


exports.sendNegotiationNotification = async ({
  lesson,
  sender,
  receiver,
  price
}) => {
  try {
    if (!receiver?.fcmToken || receiver.fcmToken === null) {
      const message = `Hi ${receiver.firstName} ${receiver.lastName}, ${sender.firstName} proposed ${price} EGP for your lesson on ${lesson.subject}. Please log in to your account to view the details and respond.`;
      try { 
        await sendEmail({ 
          Email: receiver.email, 
          subject: "New Price Offer for Your Lesson", 
          message, 
        }); 
        console.log(`Email notification sent to ${receiver.email}`);
      } catch (err) { 
        console.error("❌ Error sending email notification:", err.message);
      }
      return;
    }

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
