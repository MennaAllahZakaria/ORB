const ApiError = require("../utils/apiError");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");
const { generateZegoToken } = require("../utils/zego");
const {addPoints , deductPoints} = require("./pointsService");
const admin = require("../fireBase/admin");
const ApiFeatures = require("../utils/apiFeatures");

// ==================== STUDENT - CREATE LESSON REQUEST ====================
exports.createLessonRequest = asyncHandler(async (req, res, next) => {
  req.body.student = req.user._id;

  // ZegoCloud for meeting setup
  req.body.meetingStatus = "upcoming";
  req.body.meetingRoomId = null;
  req.body.zegoToken = null;

  const lesson = await Lesson.create(req.body);

  // 🔎 Get all teachers who teach this subject
  const teachers = await User.find({
    role: "teacher",
    "teacherProfile.subjects": req.body.subject,
  });

  // 🔔 Send notifications to all relevant teachers
  for (const teacher of teachers) {
    if (!teacher.fcmToken) continue;

    const token = decryptToken(teacher.fcmToken);
    if (!token) continue;

    const formattedDate = new Date(lesson.requestedDate).toLocaleString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    // 🈳 Language detection
    const isArabic = teacher.preferredLang === "ar";

    const title = isArabic
      ? "🎓 طلب درس جديد!"
      : "🎓 New Lesson Request!";

    const body = isArabic
      ? `📚 المادة: ${lesson.subject}\n💰 السعر: $${lesson.price}\n🕒 التاريخ: ${formattedDate}\n👤 من: ${req.user.name || "طالب"}\n\nاضغط لعرض التفاصيل.`
      : `📚 Subject: ${lesson.subject}\n💰 Price: $${lesson.price}\n🕒 Date: ${formattedDate}\n👤 From: ${req.user.name || "A student"}\n\nTap to view details.`;

    const message = {
      notification: { title, body },
      token,
      data: {
        type: "lesson_request",
        lessonId: lesson._id.toString(),
        preferredLang: teacher.preferredLang || "en",
      },
    };

    try {
      const response = await admin.messaging().send(message);
      console.log("Notification sent:", response);

      // 💾 Save notification to DB
      await Notification.create({
        sendBy: req.user._id,
        recipient: teacher._id,
        title,
        message: body.replace(/\n/g, " "),
      });
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }

  res.status(201).json({
    status: "success",
    data: lesson,
  });
});


// ==================== TEACHER - GET LESSON REQUESTS ====================
exports.getLessonRequestsForTeacher = asyncHandler(async (req, res, next) => {
    if (req.user.role !== "teacher") {
        return next(new ApiError("Only teachers can access lesson requests", 403));
    }
    const lessons = await Lesson.find({
        subject: { $in: req.user.teacherProfile.subjects },
        status: "pending",
    }).populate("student", "firstName lastName email studentProfile");
    res.status(200).json({
        status: "success",
        results: lessons.length,
        data: lessons,
    });
});

// ==================== TEACHER - RESPOND TO LESSON REQUEST ====================

exports.respondToLessonRequest = asyncHandler(async (req, res, next) => {

  const { lessonId } = req.params;
  const { response } = req.body; // response = "accept" or "reject"
  const teacherId = req.user._id;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  
  if (response === "reject") {
    return res.status(200).json({ message: "You rejected this request." });
  }

  if (lesson.status !== "pending")
    return next(new ApiError("Cannot respond to this lesson at its current status", 400));
  
  if (!lesson.interestedTeachers.includes(teacherId)) {
    lesson.interestedTeachers.push(teacherId);
    await lesson.save();
  }

  const student = await User.findById(lesson.student);

  // تحديد اللغة
  const lang = student?.preferredLang || "en";

  // 🗣️ النوتيفيكيشن بالعربية والإنجليزية
  const titles = {
    en: "✅ A teacher is interested in your lesson request!",
    ar: "✅ مدرس أبدى اهتمامه بطلب الحصة الخاص بك!",
  };

  const bodies = {
    en: `👨‍🏫 ${req.user.firstName} ${req.user.lastName} is interested in teaching ${lesson.subject}.`,
    ar: `👨‍🏫 ${req.user.firstName} ${req.user.lastName} وافق على تدريس مادة ${lesson.subject}.`,
  };

  const title = titles[lang];
  const body = bodies[lang];

  // 🔔 إرسال إشعار FCM للطالب
  if (student?.fcmToken) {
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
  }

  // 🗂️ حفظ الإشعار في قاعدة البيانات
  await Notification.create({
    sendBy: teacherId,
    recipient: student._id,
    title,
    message: body,
  });

  res.status(200).json({
    message: lang === "ar" ? "تم حفظ الرد بنجاح." : "Response saved successfully.",
    data: lesson,
  });
});


// ==================== STUDENT - CHOOSE THE TEACHER ====================

exports.chooseTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId, teacherId } = req.params;
  const {price} = req.body;
  const lesson = await Lesson.findById(lessonId);

  if (!lesson) return next(new ApiError("Lesson not found", 404));
  if (lesson.student.toString() !== req.user._id.toString())
    return next(new ApiError("You are not authorized to modify this lesson", 403));

  if (lesson.status !== "pending")
    return next(new ApiError("Cannot choose a teacher for this lesson at its current status", 400));

  if (!lesson.interestedTeachers.includes(teacherId))
    return next(new ApiError("This teacher did not express interest", 400));

  // ✅ accept the teacher
  lesson.acceptedTeacher = teacherId;
  lesson.status = "approved";

  // finalize price if provided
  if (price) {
    lesson.price = price;
  }

  // 🎥 ZegoCloud init room
  const meetingRoomId = `lesson_${uuidv4()}`;

  // 💬 generate tokens
  const teacherToken = generateZegoToken( teacherId, meetingRoomId);
  const studentToken = generateZegoToken( req.user._id.toString(), meetingRoomId);

  lesson.meetingRoomId = meetingRoomId;
  lesson.zegoToken = null; // Tokens are generated per user
  lesson.meetingStatus = "upcoming";

  await lesson.save();

  // 📩 notification details
  const teacher = await User.findById(teacherId);
  const student = await User.findById(lesson.student);
  const lang = teacher?.preferredLang || "ar";

  const titles = {
    ar: "🎉 تم اختيارك لتدريس الدرس عبر ZegoCloud 🎥",
    en: "🎉 You've been selected to teach this lesson on ZegoCloud 🎥",
  };

  const bodies = {
                  ar: `👩‍🎓 الطالب ${student.firstName} ${student.lastName} اختارك لتدريس مادة ${lesson.subject}.
              📅 يمكنك الآن بدء الجلسة في وقتها المحدد.`,
                  en: `👩‍🎓 The student ${student.firstName} ${student.lastName} selected you to teach ${lesson.subject}.
              📅 You can start the session at the scheduled time.`,
                };

  const title = titles[lang];
  const body = bodies[lang];

  // 🔔 send notification
  if (teacher?.fcmToken) {
    const token = decryptToken(teacher.fcmToken);
    if (token) {
      await admin.messaging().send({
        notification: { title, body },
        token,
        data: {
          type: "lesson_approved",
          lessonId: lesson._id.toString(),
          meetingRoomId,
        },
      });
    }
  }

  // 🗂️ حفظ الإشعار في قاعدة البيانات
  await Notification.create({
    sendBy: req.user._id,
    recipient: teacherId,
    title,
    message: body,
  });

  res.status(200).json({
    message: lang === "ar" ? "تم اختيار المدرس وإنشاء الغرفة بنجاح." : "Teacher selected and room created successfully.",
    data: {
      lesson,
      meetingRoomId,
      tokens: {
        student: studentToken,
        teacher: teacherToken,
      },
    },
  });
});

// ==================== STUDENT - GET ALL INTERESTED TEACHERS FOR LESSON ====================

exports.getInterestedTeachers = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  // 🔍 التحقق من وجود الحصة
  const lesson = await Lesson.findById(lessonId).populate({
    path: "interestedTeachers",
    select: "firstName lastName email profileImage subjects rating bio experience",
  });

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  // ✅ التحقق أن الطالب هو صاحب الطلب فقط
  if (lesson.student.toString() !== req.user._id.toString()) {
    return next(new ApiError("You are not authorized to view this lesson’s teachers", 403));
  }

  // 📋 المدرسين المهتمين
  const teachers = lesson.interestedTeachers;

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers,
  });
});


// ================== GET ALL LESSONS ==================
exports.getLessons = asyncHandler(async (req, res, next) => {
  const user = req.user;
  let filter = {};

  // 🎓 student -> get only his lesson
  if (user.role === "student") {
    filter = { student: user._id };

  // 👨‍🏫 teacher -> can veiw all his interested lessons
  } else if (user.role === "teacher") {
    filter = {
      $or: [
        { subject: { $in: user.subjects || [] } },
        { interestedTeachers: user._id },
      ],
    };

  // 👨‍💼 admin can view all 
  } else if (user.role === "admin") {
    filter = {};

  } else {
    return next(new ApiError("You are not authorized to view lessons", 403));
  }

  // 📊 حساب عدد الدروس
  const lessonsCount = await Lesson.countDocuments(filter);

  // ⚙️ تطبيق ApiFeatures
  const apiFeatures = new ApiFeatures(
    Lesson.find(filter)
      .populate("student", "firstName lastName email")
      .populate("acceptedTeacher", "firstName lastName email")
      .populate("interestedTeachers", "firstName lastName email"),
    req.query
  )
    .filter() // ?subject=Math
    .search("lessonModel") // ?keyword=english
    .sort() // ?sort=-createdAt
    .limitFields() // ?fields=subject,status
    .paginate(lessonsCount); // ?page=2&limit=10

  const { mongooseQuery, paginationResult } = apiFeatures;
  const lessons = await mongooseQuery;

  // 📤 الإرسال
  res.status(200).json({
    status: "success",
    results: lessons.length,
    pagination: paginationResult,
    data: lessons,
  });
});


// ================== COMPLETE LESSON AND RELEASE FUNDS ==================
exports.completeLesson = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  lesson.status = "completed";
  await lesson.save();
    // ✅ Add points for completing lesson
  if (lesson.student?._id) {
    await addPoints(lesson.student._id, 20, "Lesson completed");
  }

  const teacher = await User.findById(lesson.acceptedTeacher);
  if (teacher?.teacherProfile?.paymentInfo?.payoutRecipientId) {
    const paymentController = require("./paymentService");
    paymentController.releasePaymentToTeacher({ params: { lessonId } }, res, next);
  }

  res.status(200).json({ message: "Lesson completed and funds released." });
});


// =============================== STUDENT - CANCEL LESSON REQUEST ===============================
exports.cancelLessonRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));
  if (lesson.student.toString() !== req.user._id.toString())
    return next(new ApiError("You are not authorized to cancel this lesson", 403));
  lesson.status = "canceled";
  await lesson.save();

  // ⚠️ Deduct points for cancellation
  if (lesson.student?._id) {
    await deductPoints(lesson.student._id, 15);
  }

  res.status(200).json({ message: "Lesson request canceled successfully." });

});