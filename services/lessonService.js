const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const Notification = require("../models/notificationModel");

const { decryptToken } = require("../utils/fcmToken");
const { v4: uuidv4 } = require("uuid");
const { generateZegoToken } = require("../utils/zego");
const { addPoints, deductPoints } = require("./pointsService");

const admin = require("../fireBase/admin");
const sendEmail = require("../utils/sendEmail"); 
const ApiFeatures = require("../utils/apiFeatures");

// Small helper to compare ObjectIds safely
const isSameId = (a, b) =>
  a && b && a.toString() === b.toString();

// =======================================================
// 1️⃣ STUDENT - CREATE LESSON REQUEST
// =======================================================
exports.createLessonRequest = asyncHandler(async (req, res, next) => {
  const { subject, requestedDate, durationInMinutes, price, teacherId, title } =
    req.body;

  // Basic validation (can be extended)
  if (!subject || !requestedDate || !durationInMinutes || !price || !title) {
    return next(
      new ApiError("title, subject, requestedDate, durationInMinutes and price are required", 400)
    );
  }

  // Determine request type: direct (specific teacher) or open
  const requestType = teacherId ? "direct" : "open";

  // Build lesson payload explicitly (avoid using req.body directly)
  const lessonPayload = {
    student: req.user._id,
    title,
    subject,
    requestedDate,
    durationInMinutes,
    price,
    requestType,
    meetingStatus: "upcoming",
    meetingRoomId: null,
    zegoTokenForStudent: null,
    zegoTokenForTeacher: null,
  };

  const lesson = await Lesson.create(lessonPayload);

  let teachers = [];

  // 🎯 Direct request to a specific teacher
  if (teacherId) {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return next(new ApiError("Teacher not found", 404));
    }

    teachers = [teacher];

    // Optionally mark this teacher as interested by default
    lesson.interestedTeachers.push(teacher._id);
    await lesson.save();
  } else {
    // 🎯 Open request – find matching teachers by subject and price range
    const requested = new Date(requestedDate);

    // Price range (±20% around student's proposed price)
    const minPrice = price * 0.8;
    const maxPrice = price * 1.2;

    // Find teachers who teach this subject
    const allTeachers = await User.find({
      role: "teacher",
      "teacherProfile.subjects": subject,
    });

    // Filter teachers by effective lesson price based on their pricePerHour
    teachers = allTeachers.filter((teacher) => {
      const hourlyPrice = teacher.teacherProfile?.pricePerHour || 0;
      if (!hourlyPrice) return false;
      const calculatedLessonPrice = (hourlyPrice / 60) * durationInMinutes;
      return (
        calculatedLessonPrice >= minPrice &&
        calculatedLessonPrice <= maxPrice
      );
    });
  }

  // 🔔 Send notifications to matching teachers (FCM or email)
  const studentName =
    `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() ||
    "A student";

  for (const teacher of teachers) {
    // If no fcmToken → fallback to email
    if (!teacher.fcmToken) {
      const message = `
                    Hi ${teacher.firstName} ${teacher.lastName},
                    A new lesson request has been posted for the subject: ${lesson.subject} with ${lesson.price} EGP.
                    Please log in to your account to view the details and respond.
                          `;
      try {
        await sendEmail({
          Email: teacher.email,
          subject: "New Lesson Request Available",
          message,
        });
      } catch (err) {
        console.error("❌ Error sending email notification:", err.message);
      }
      continue;
    }

    const token = decryptToken(teacher.fcmToken);
    if (!token) continue;

    const formattedDate = new Date(lesson.requestedDate).toLocaleString(
      "en-US",
      {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }
    );

    const isArabic = teacher.preferredLang === "ar";

    const titleNoti = isArabic ? "🎓 طلب درس جديد!" : "🎓 New Lesson Request!";
    const bodyNoti = isArabic
      ? `📚 المادة: ${lesson.subject}\n💰 السعر المقترح: ${lesson.price} EGP\n🕒 التاريخ: ${formattedDate}\n⏱️ المدة: ${lesson.durationInMinutes} دقيقة\n👤 من: ${studentName}`
      : `📚 Subject: ${lesson.subject}\n💰 Proposed Price: ${lesson.price} EGP\n🕒 Date: ${formattedDate}\n⏱️ Duration: ${lesson.durationInMinutes} min\n👤 From: ${studentName}`;

    try {
      await admin.messaging().send({
        notification: { title: titleNoti, body: bodyNoti },
        token,
        data: {
          type: "lesson_request",
          lessonId: lesson._id.toString(),
          preferredLang: teacher.preferredLang || "en",
        },
      });

      await Notification.create({
        sendBy: req.user._id,
        recipient: teacher._id,
        title: titleNoti,
        message: bodyNoti.replace(/\n/g, " "),
      });
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }

  res.status(201).json({
    status: "success",
    message:
      requestType === "direct"
        ? "Lesson request sent to the selected teacher."
        : "Lesson request sent to all matching teachers.",
    data: lesson,
  });
});

// =======================================================
// 2️⃣ TEACHER - GET LESSON REQUESTS (Matching Subjects)
// =======================================================
exports.getLessonRequestsForTeacher = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can access lesson requests", 403));
  }

  // Ensure we have teacherProfile.subjects
  const teacher = await User.findById(req.user._id).select(
    "teacherProfile.subjects"
  );
  if (!teacher || !teacher.teacherProfile?.subjects?.length) {
    return next(
      new ApiError("Teacher has no subjects configured in profile", 400)
    );
  }

  const lessons = await Lesson.find({
    subject: { $in: teacher.teacherProfile.subjects },
    status: "pending",
  }).populate("student", "firstName lastName email studentProfile");

  res.status(200).json({
    status: "success",
    results: lessons.length,
    data: lessons,
  });
});

// =======================================================
// 3️⃣ TEACHER - COUNTER OFFER FOR LESSON
// =======================================================
exports.counterOfferFromTeacher = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can send counter offers", 403));
  }

  const { lessonId } = req.params;
  const { proposedPrice, message } = req.body;

  if (!proposedPrice || proposedPrice <= 0) {
    return next(
      new ApiError("proposedPrice must be a positive number", 400)
    );
  }

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  const isInterested = lesson.interestedTeachers.some((id) =>
    isSameId(id, req.user._id)
  );
  if (!isInterested) {
    return next(
      new ApiError("You must first express interest in this lesson", 400)
    );
  }

  let existingOffer = lesson.offers.find((o) =>
    isSameId(o.teacher, req.user._id)
  );

  if (existingOffer) {
    existingOffer.proposedPrice = proposedPrice;
    existingOffer.message = message;
    existingOffer.createdAt = Date.now();
  } else {
    lesson.offers.push({
      teacher: req.user._id,
      proposedPrice,
      message,
    });
  }

  await lesson.save();

  // Notify student of new/updated counter offer
  const student = await User.findById(lesson.student);
  if (student?.fcmToken) {
    const token = decryptToken(student.fcmToken);
    if (token) {
      const body = `${req.user.firstName} proposed a new price: ${proposedPrice} EGP`;
      await admin.messaging().send({
        notification: {
          title: "💬 New Counter Offer",
          body,
        },
        token,
        data: {
          type: "counter_offer",
          lessonId: lesson._id.toString(),
        },
      });

      await Notification.create({
        sendBy: req.user._id,
        recipient: student._id,
        title: "New Counter Offer",
        message: body,
      });
    }
  }

  res.status(200).json({
    status: "success",
    message: "Counter offer sent successfully",
    data: lesson,
  });
});

// =======================================================
// 4️⃣ STUDENT - GET OFFERS FOR A LESSON
// =======================================================
exports.getOffersForLesson = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate({
    path: "offers.teacher",
    select:
      "firstName lastName email imageProfile teacherProfile.subjects teacherProfile.avgRating teacherProfile.bio teacherProfile.experienceYears",
  });

  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError(
        "You are not authorized to view offers for this lesson",
        403
      )
    );
  }

  res.status(200).json({
    status: "success",
    results: lesson.offers.length,
    data: lesson.offers,
  });
});

// =======================================================
// 5️⃣ TEACHER - RESPOND TO LESSON REQUEST (INTEREST/REJECT)
// =======================================================
exports.respondToLessonRequest = asyncHandler(async (req, res, next) => {
  if (req.user.role !== "teacher") {
    return next(new ApiError("Only teachers can respond to lesson requests", 403));
  }

  const { lessonId } = req.params;
  const { response } = req.body; // "accept" or "reject"
  const teacherId = req.user._id;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  // Reject: just remove teacher from interestedTeachers (if present)
  if (response === "reject") {
    lesson.interestedTeachers = lesson.interestedTeachers.filter(
      (id) => !isSameId(id, teacherId)
    );
    await lesson.save();
    return res.status(200).json({ message: "You rejected this request." });
  }

  if (lesson.status !== "pending") {
    return next(
      new ApiError(
        "Cannot respond to this lesson at its current status",
        400
      )
    );
  }

  // Mark teacher as interested if not already
  const alreadyInterested = lesson.interestedTeachers.some((id) =>
    isSameId(id, teacherId)
  );
  if (!alreadyInterested) {
    lesson.interestedTeachers.push(teacherId);
    await lesson.save();
  }

  const student = await User.findById(lesson.student);
  if (!student) {
    return res.status(200).json({
      message: "Response saved but student not found (no notification sent).",
      data: lesson,
    });
  }

  const lang = student.preferredLang || "en";

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

  // FCM notification
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
      sendBy: teacherId,
      recipient: student._id,
      title,
      message: body,
    });
  } else {
    // Fallback to email
    const message = `
                  Hi ${student.firstName} ${student.lastName},
                  A teacher (${req.user.firstName} ${req.user.lastName}) has shown interest in teaching your requested lesson on ${lesson.subject} (${lesson.title}).
                  Please log in to your account to view the details and choose your preferred teacher.
                      `;
    try {
      await sendEmail({
        Email: student.email,
        subject: "A Teacher is Interested in Your Lesson Request",
        message,
      });
    } catch (err) {
      console.error("❌ Error sending email notification:", err.message);
    }
  }

  res.status(200).json({
    message: lang === "ar" ? "تم حفظ الرد بنجاح." : "Response saved successfully.",
    data: lesson,
  });
});

// =======================================================
// 6️⃣ STUDENT - UPDATE LESSON PRICE REQUEST
// =======================================================
exports.updateLessonPriceRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const { newPrice } = req.body;

  if (!newPrice || newPrice <= 0) {
    return next(
      new ApiError("newPrice must be a positive number", 400)
    );
  }

  const lesson = await Lesson.findById(lessonId).select(
    "student status acceptedTeacher price"
  );

  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError("You are not authorized to modify this lesson", 403)
    );
  }

  if (lesson.status !== "pending" || lesson.acceptedTeacher) {
    return next(
      new ApiError(
        "Cannot update price for this lesson at its current status",
        400
      )
    );
  }

  lesson.price = newPrice;
  await lesson.save();

  res.status(200).json({
    message: "Lesson price updated successfully.",
    data: lesson,
  });
});

// =======================================================
// 7️⃣ STUDENT - CHOOSE TEACHER FOR LESSON
// =======================================================
exports.chooseTeacher = asyncHandler(async (req, res, next) => {
  const { lessonId, teacherId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError("You are not authorized to modify this lesson", 403)
    );
  }

  if (lesson.status !== "pending") {
    return next(
      new ApiError(
        "Cannot choose a teacher for this lesson at its current status",
        400
      )
    );
  }

  const isInterested = lesson.interestedTeachers.some((id) =>
    isSameId(id, teacherId)
  );
  if (!isInterested) {
    return next(new ApiError("This teacher did not express interest", 400));
  }

  // Accept the teacher
  lesson.acceptedTeacher = teacherId;
  lesson.status = "approved";

  // Finalize price if teacher made an offer
  const offer = lesson.offers.find((o) =>
    isSameId(o.teacher, teacherId)
  );
  if (offer && offer.proposedPrice) {
    lesson.price = offer.proposedPrice;
  }

  // 🎥 ZegoCloud room + tokens
  const meetingRoomId = `lesson_${uuidv4()}`;

  const teacherToken = generateZegoToken(
    teacherId.toString(),
    meetingRoomId
  );
  const studentToken = generateZegoToken(
    req.user._id.toString(),
    meetingRoomId
  );

  lesson.zegoTokenForStudent = studentToken;
  lesson.zegoTokenForTeacher = teacherToken;
  lesson.meetingRoomId = meetingRoomId;
  lesson.meetingStatus = "upcoming";

  await lesson.save();

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

  // Notify teacher
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

    await Notification.create({
      sendBy: req.user._id,
      recipient: teacherId,
      title,
      message: body,
    });
  } else {
    const message = `
                  Hi ${teacher.firstName} ${teacher.lastName},
                  The student ${student.firstName} ${student.lastName} has selected you to teach the lesson on ${lesson.subject}.
                  Please log in to your account to view the details and prepare for the session.
                      `;
    try {
      await sendEmail({
        Email: teacher.email,
        subject: "You've Been Selected to Teach a Lesson",
        message,
      });
    } catch (err) {
      console.error("❌ Error sending email notification:", err.message);
    }
  }

  res.status(200).json({
    message:
      lang === "ar"
        ? "تم اختيار المدرس وإنشاء الغرفة بنجاح."
        : "Teacher selected and room created successfully.",
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

// =======================================================
// 8️⃣ STUDENT - GET INTERESTED TEACHERS FOR LESSON
// =======================================================
exports.getInterestedTeachers = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId).populate({
    path: "interestedTeachers",
    select:
      "firstName lastName email imageProfile teacherProfile.subjects teacherProfile.avgRating teacherProfile.bio teacherProfile.experienceYears",
  });

  if (!lesson) {
    return next(new ApiError("Lesson not found", 404));
  }

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError(
        "You are not authorized to view this lesson’s teachers",
        403
      )
    );
  }

  const teachers = lesson.interestedTeachers;

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers,
  });
});

// =======================================================
// 9️⃣ GET ALL LESSONS (Student/Teacher/Admin) + Filters
// =======================================================
exports.getLessons = asyncHandler(async (req, res, next) => {
  const user = req.user;
  let filter = {};

  if (user.role === "student") {
    filter = { student: user._id };
  } else if (user.role === "teacher") {
    // For teachers: lessons they're accepted in OR interested in
    filter = {
      $or: [{ acceptedTeacher: user._id }, { interestedTeachers: user._id }],
    };
  } else if (user.role === "admin") {
    filter = {};
  } else {
    return next(new ApiError("You are not authorized to view lessons", 403));
  }

  const lessonsCount = await Lesson.countDocuments(filter);

  const apiFeatures = new ApiFeatures(
    Lesson.find(filter)
      .populate("student", "firstName lastName email")
      .populate("acceptedTeacher", "firstName lastName email")
      .populate("interestedTeachers", "firstName lastName email"),
    req.query
  )
    .filter()
    // NOTE: make sure the search() implementation matches this key
    .search("lessonModel")
    .sort()
    .limitFields()
    .paginate(lessonsCount);

  const { mongooseQuery, paginationResult } = apiFeatures;
  const lessons = await mongooseQuery;

  res.status(200).json({
    status: "success",
    results: lessons.length,
    pagination: paginationResult,
    data: lessons,
  });
});

// =======================================================
// 🔟 COMPLETE LESSON (NO PAYOUT HERE – JUST STATUS + POINTS)
// =======================================================
exports.completeLesson = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  // Only student, accepted teacher, or admin can complete
  const isStudent = isSameId(lesson.student, req.user._id);
  const isTeacher = isSameId(lesson.acceptedTeacher, req.user._id);
  const isAdmin = req.user.role === "admin";

  if (!isStudent && !isTeacher && !isAdmin) {
    return next(
      new ApiError("You are not authorized to complete this lesson", 403)
    );
  }

  if (lesson.status !== "approved") {
    return next(
      new ApiError("Lesson cannot be completed at its current status", 400)
    );
  }

  lesson.status = "completed";
  await lesson.save();

  // Add points to student
  if (lesson.student) {
    await addPoints(lesson.student, 20, "Lesson completed");
  }

  // ⚠️ Payout should be triggered by a separate endpoint / cron / admin action
  // to avoid mixing business flows and double responses.

  res.status(200).json({
    status: "success",
    message: "Lesson marked as completed.",
    data: lesson,
  });
});

// =======================================================
// 1️⃣1️⃣ STUDENT - CANCEL LESSON REQUEST
// =======================================================
exports.cancelLessonRequest = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return next(new ApiError("Lesson not found", 404));

  if (!isSameId(lesson.student, req.user._id)) {
    return next(
      new ApiError("You are not authorized to cancel this lesson", 403)
    );
  }

  // Block cancel if lesson already completed or canceled
  if (lesson.status === "completed" || lesson.status === "canceled") {
    return next(
      new ApiError("This lesson cannot be canceled at its current status", 400)
    );
  }

  // Optional: block cancel if already paid
  if (
    lesson.paymentStatus === "paid" ||
    lesson.paymentStatus === "released"
  ) {
    return next(
      new ApiError(
        "Cannot cancel a lesson that has already been paid. Please contact support.",
        400
      )
    );
  }

  lesson.status = "canceled";
  await lesson.save();

  // Deduct points for cancellation
  if (lesson.student) {
    await deductPoints(lesson.student, 15);
  }

  res.status(200).json({
    status: "success",
    message: "Lesson request canceled successfully.",
    data: lesson,
  });
});
