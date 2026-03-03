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

        if (!teacher.fcmToken || teacher.fcmToken === null) {
          const message = `Hi ${teacher.firstName} ${teacher.lastName}, A new lesson request has been posted by ${studentName} for the subject: ${lesson.subject} with ${lesson.price} EGP. Please log in to your account to view the details and respond.`;
          try { 
            await sendEmail({ 
              Email: teacher.email, 
              subject: "New Lesson Request Available", 
              message, 
            }); 
            console.log(`Email notification sent to ${teacher.email}`);
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


exports.sendInterestNotification = async (lesson, teacher , proposedPrice) => {

  try {

    const student = await User.findById(lesson.student);
    if (!student) return;

    const lang = student.preferredLang || "en";

    const titles = {
      en: "✅ A teacher is interested in your lesson request!",
      ar: "✅ مدرس أبدى اهتمامه بطلب الحصة الخاص بك!"
    };

    const bodies = {
      en: `👨‍🏫 ${teacher.firstName} ${teacher.lastName} is interested in teaching ${lesson.subject} with a proposed price of ${proposedPrice} EGP.`,
      ar: `👨‍🏫 ${teacher.firstName} ${teacher.lastName} وافق على تدريس مادة ${lesson.subject} بسعر مقترح قدره ${proposedPrice} EGP.`
    };

    const title = titles[lang];
    const body = bodies[lang];

    if (student.fcmToken && student.fcmToken !== null) {

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


exports.sendChooseTeacherNotification = async (lessonId, teacherId, studentUser) => {

  try {

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return;

    const teacher = await User.findById(teacherId);
    const student = await User.findById(lesson.student);

    if (!teacher || !student) return;

    const lang = teacher.preferredLang || "ar";

    const titles = {
      ar: "🎉 تم اختيارك لتدريس الدرس عبر ZegoCloud 🎥",
      en: "🎉 You've been selected to teach this lesson 🎥"
    };

    const bodies = {
      ar: `👩‍🎓 الطالب ${student.firstName} ${student.lastName} اختارك لتدريس مادة ${lesson.subject}.`,
      en: `👩‍🎓 ${student.firstName} ${student.lastName} selected you to teach ${lesson.subject}.`
    };

    const title = titles[lang];
    const body = bodies[lang];

    if (teacher.fcmToken) {

      const token = decryptToken(teacher.fcmToken);

      if (token) {
        await admin.messaging().send({
          notification: { title, body },
          token,
          data: {
            type: "lesson_approved",
            lessonId: lesson._id.toString()
          }
        });
      }

      await Notification.create({
        type: "lesson_approved",
        referenceId: lesson._id,
        sendBy: studentUser._id,
        recipient: teacher._id,
        title,
        message: body
      });

    } else {
      await sendEmail({
        Email: teacher.email,
        subject: title,
        message: body
      });
    }

  } catch (err) {
    console.error("ChooseTeacher notification error:", err.message);
  }
}
