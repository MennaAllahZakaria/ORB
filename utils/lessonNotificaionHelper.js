const asyncHandler = require("express-async-handler");
const ApiError = require("./apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");

const { decryptToken } = require("./fcmToken");

const admin = require("../fireBase/admin");
const sendEmail = require("./sendEmail"); 


exports.sendLessonNotifications = async (lesson, teachers, student) => {

  const studentName =
    `${student.firstName || ""} ${student.lastName || ""}`.trim() ||
    "A student";

  await Promise.allSettled(
    teachers.map(async (teacher) => {

      try {

        if (!teacher.fcmToken) {
          const message = `Hi ${teacher.firstName} ${teacher.lastName}, A new lesson request has been posted for the subject: ${lesson.subject} with ${lesson.price} EGP. Please log in to your account to view the details and respond.`;
          try { 
            await sendEmail({ 
              Email: teacher.email, 
              subject: "New Lesson Request Available", 
              message, 
            }); 
          } catch (err) { 
            console.error("❌ Error sending email notification:", err.message); 

        } 
          return;
        }

        const token = decryptToken(teacher.fcmToken);
        if (!token) return;

        const isArabic = teacher.preferredLang === "ar";

        const formattedDate = new Date(lesson.requestedDate)
          .toLocaleString("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });

        const title = isArabic
          ? "🎓 طلب درس جديد!"
          : "🎓 New Lesson Request!";

        const body = isArabic
          ? `📚 المادة: ${lesson.subject}\n💰 السعر: ${lesson.price} EGP\n🕒 ${formattedDate}`
          : `📚 Subject: ${lesson.subject}\n💰 Price: ${lesson.price} EGP\n🕒 ${formattedDate}`;

        await admin.messaging().send({
          notification: { title, body },
          token,
          data: {
            type: "lesson_request",
            lessonId: lesson._id.toString()
          }
        });

        await Notification.create({
          type: "lesson_request",
          referenceId: lesson._id,
          sendBy: student._id,
          recipient: teacher._id,
          title,
          message: body.replace(/\n/g, " ")
        });

      } catch (err) {
        console.error("Notification error:", err.message);
      }

    })
  );

  console.log("Lesson notifications processed");

}


exports.sendInterestNotification = async (lesson, teacher) => {

  try {

    const student = await User.findById(lesson.student);
    if (!student) return;

    const lang = student.preferredLang || "en";

    const titles = {
      en: "✅ A teacher is interested in your lesson request!",
      ar: "✅ مدرس أبدى اهتمامه بطلب الحصة الخاص بك!"
    };

    const bodies = {
      en: `👨‍🏫 ${teacher.firstName} ${teacher.lastName} is interested in teaching ${lesson.subject}.`,
      ar: `👨‍🏫 ${teacher.firstName} ${teacher.lastName} وافق على تدريس مادة ${lesson.subject}.`
    };

    const title = titles[lang];
    const body = bodies[lang];

    if (student.fcmToken) {

      const token = decryptToken(student.fcmToken);

      if (token) {
        await admin.messaging().send({
          notification: { title, body },
          token,
          data: {
            type: "teacher_interest",
            lessonId: lesson._id.toString(),
          },
        });
      }

      await Notification.create({
        type: "teacher_interest",
        referenceId: lesson._id,
        sendBy: teacher._id,
        recipient: student._id,
        title,
        message: body,
      });

    } else {

      await sendEmail({
        Email: student.email,
        subject: "A Teacher is Interested in Your Lesson Request",
        message: body,
      });

    }

  } catch (err) {
    console.error("Interest notification error:", err.message);
  }
}
