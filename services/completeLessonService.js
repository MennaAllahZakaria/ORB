const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const User = require("../models/userModel");
const Lesson = require("../models/lessonModel");
const CompleteLesson = require("../models/completeLossonModel");
const Review = require("../models/reviewModel");
const Notification = require("../models/notificationModel");
const mongoose = require("mongoose");
const {
  handleRefund,
  handleLessonCompletion
} = require("./payment/paymentHandleService");


exports.submitCompletion = asyncHandler(async (req, res, next) => {
  const { lessonId } = req.params;
  const {
    completionStatus,
    reasonForIncomplete,
    description,
  } = req.body;

  const user = req.user;

  /* =====================================================
     1. VALIDATE COMPLETION STATUS
  ===================================================== */

  if (!["completed", "incomplete"].includes(completionStatus)) {
    return next(
      new ApiError(
        "completionStatus must be either completed or incomplete",
        400
      )
    );
  }

  /* =====================================================
     2. INCOMPLETE REQUIRES A REASON
  ===================================================== */

  if (
    completionStatus === "incomplete" &&
    !reasonForIncomplete?.trim()
  ) {
    return next(
      new ApiError(
        "Reason is required when reporting a problem",
        400
      )
    );
  }

  /* =====================================================
     3. FIND LESSON
  ===================================================== */

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return next(
      new ApiError("Lesson not found", 404)
    );
  }

  /* =====================================================
     4. DETERMINE USER ROLE IN THIS LESSON
  ===================================================== */

  let role;

  if (isSameId(lesson.student, user._id)) {
    role = "student";
  } else if (
    lesson.acceptedTeacher &&
    isSameId(lesson.acceptedTeacher, user._id)
  ) {
    role = "teacher";
  } else {
    return next(
      new ApiError(
        "You are not authorized to submit completion for this lesson",
        403
      )
    );
  }

  /* =====================================================
     5. LESSON MUST BE PAID
  ===================================================== */

  if (lesson.paymentStatus !== "paid") {
    return next(
      new ApiError(
        "Lesson must be paid before submitting completion",
        400
      )
    );
  }

  /* =====================================================
     6. LESSON MUST HAVE STARTED
  ===================================================== */

  if (!lesson.meetingStartTime) {
    return next(
      new ApiError(
        "Lesson has not started yet",
        400
      )
    );
  }

  /* =====================================================
     7. LESSON MUST HAVE ENDED
  ===================================================== */

  const now = new Date();

  let lessonEndTime = lesson.meetingEndTime;

  /*
    If meetingEndTime is not available,
    calculate expected end time from:
    meetingStartTime + durationInMinutes
  */

  if (!lessonEndTime) {
    lessonEndTime = new Date(
      new Date(lesson.meetingStartTime).getTime() +
      lesson.durationInMinutes * 60 * 1000
    );
  }

  if (now < new Date(lessonEndTime)) {
    return next(
      new ApiError(
        "You cannot submit completion before the lesson has ended",
        400
      )
    );
  }

  /* =====================================================
     8. PREVENT SUBMISSION AFTER FINAL RESOLUTION
  ===================================================== */

  if (
    lesson.reviewStatus === "resolved_by_admin"
  ) {
    return next(
      new ApiError(
        "This lesson has already been resolved",
        400
      )
    );
  }

  /* =====================================================
     9. CHECK EXISTING SUBMISSION FOR THIS ROLE
  ===================================================== */

  const existingSubmission =
    await CompleteLesson.findOne({
      lesson: lessonId,
      role,
    });

  if (existingSubmission) {
    return next(
      new ApiError(
        "You have already submitted completion for this lesson",
        400
      )
    );
  }

  /* =====================================================
     10. CREATE SUBMISSION
  ===================================================== */

  let submission;

  try {
    submission = await CompleteLesson.create({
      lesson: lessonId,
      submittedBy: user._id,
      role,
      completionStatus,

      reasonForIncomplete:
        completionStatus === "incomplete"
          ? reasonForIncomplete.trim()
          : null,

      description:
        description?.trim() || null,

      proofImage:
        req.proofImageUrl || null,
    });
  } catch (err) {
    /*
      Unique index:
      { lesson: 1, role: 1 }

      Protect against two simultaneous requests.
    */

    if (err.code === 11000) {
      return next(
        new ApiError(
          "You have already submitted completion for this lesson",
          400
        )
      );
    }

    throw err;
  }

  /* =====================================================
    11. CHECK BOTH SUBMISSIONS
  ===================================================== */

  /*
    IMPORTANT:

    We check both submissions regardless of
    the current user's completionStatus.

    This is important because:

    Student = incomplete
    Teacher = completed

    OR

    Student = completed
    Teacher = incomplete

    must both become disputed.
  */

  const submissions = await CompleteLesson.find({
    lesson: lessonId,
  });

  const studentSubmission = submissions.find(
    (item) => item.role === "student"
  );

  const teacherSubmission = submissions.find(
    (item) => item.role === "teacher"
  );


  /* =====================================================
    12. WAITING FOR SECOND PARTY
  ===================================================== */

  /*
    Only one party has submitted so far.

    The lesson stays in problem/waiting_second_party
    ONLY if the submitted party reported incomplete.

    If the first party reported completed,
    we simply wait for the second party without
    marking the lesson as a problem.
  */

  if (!studentSubmission || !teacherSubmission) {

    if (completionStatus === "incomplete") {

      lesson.status = "problem";

      lesson.finalCompletionStatus = "incomplete";

      lesson.reviewStatus = "waiting_second_party";

      lesson.disputeFlag = true;

      await lesson.save();

      return res.status(201).json({
        status: "success",

        message:
          "Problem reported successfully. Waiting for the other party to submit their response.",

        data: {
          submission,

          lessonStatus: {
            status: lesson.status,

            finalCompletionStatus:
              lesson.finalCompletionStatus,

            reviewStatus:
              lesson.reviewStatus,

            disputeFlag:
              lesson.disputeFlag,
          },
        },
      });
    }

    /*
      First party said completed.

      Preserve the legacy frontend contract: the lesson is listed as
      completed while waiting for the second party's review response.
      The payment flow still requires both confirmations before release.
    */
    lesson.finalCompletionStatus = "completed";
    lesson.reviewStatus = "waiting_second_party";
    lesson.disputeFlag = false;
    await lesson.save();

    return res.status(201).json({
      status: "success",

      message:
        "Your completion confirmation has been recorded. Waiting for the other party.",

      data: {
        submission,

        lessonStatus: {
          status: lesson.status,

          finalCompletionStatus:
            lesson.finalCompletionStatus,

          reviewStatus:
            lesson.reviewStatus,

          disputeFlag:
            lesson.disputeFlag,
        },
      },
    });
  }


  /* =====================================================
    13. BOTH PARTIES SUBMITTED
  ===================================================== */

  const studentStatus =
    studentSubmission.completionStatus;

  const teacherStatus =
    teacherSubmission.completionStatus;


  /* =====================================================
    CASE A
    BOTH COMPLETED
  ===================================================== */

  if (
    studentStatus === "completed" &&
    teacherStatus === "completed"
  ) {
    /* =========================================
      LESSON IS SUCCESSFULLY COMPLETED
    ========================================= */

    lesson.status = "approved";

    lesson.finalCompletionStatus = "completed";

    lesson.reviewStatus = "auto_resolved";

    lesson.disputeFlag = false;

    await lesson.save();


    /* =========================================
      UPDATE SUBMISSIONS
    ========================================= */

    studentSubmission.reviewStatus =
      "auto_resolved";

    teacherSubmission.reviewStatus =
      "auto_resolved";

    await studentSubmission.save();
    await teacherSubmission.save();


    /* =========================================
      HANDLE PAYMENT RELEASE
    ========================================= */

    let completionResult;

    try {
      completionResult =
        await handleLessonCompletion(
          lesson._id
        );
    } catch (err) {
      console.error(
        "[HANDLE LESSON COMPLETION ERROR]",
        err
      );

      /*
        The lesson itself is already confirmed
        as completed by both parties.

        Payment release failure should NOT make
        the completion submission fail.

        It can be retried later.
      */
    }


    /* =========================================
      RESPONSE
    ========================================= */

    return res.status(201).json({
      status: "success",

      message:
        "Both parties confirmed that the lesson was completed successfully.",

      data: {
        submission,

        lessonStatus: {
          status: lesson.status,

          finalCompletionStatus:
            lesson.finalCompletionStatus,

          reviewStatus:
            lesson.reviewStatus,

          disputeFlag:
            lesson.disputeFlag,

          paymentStatus:
            lesson.paymentStatus,

          fundsStatus:
            lesson.fundsStatus,
        },

        completion:
          completionResult || {
            decision: "hold",
          },
      },
    });
  }


  /* =====================================================
    CASE B
    BOTH INCOMPLETE
  ===================================================== */

  if (
    studentStatus === "incomplete" &&
    teacherStatus === "incomplete"
  ) {

    const studentReason =
      studentSubmission.reasonForIncomplete
        ?.trim()
        .toLowerCase();

    const teacherReason =
      teacherSubmission.reasonForIncomplete
        ?.trim()
        .toLowerCase();


    /*
      Safety check.

      This should normally never happen because
      incomplete requires a reason.
    */

    if (!studentReason || !teacherReason) {

      return next(
        new ApiError(
          "Both incomplete submissions must contain a reason",
          400
        )
      );
    }


    /* ===================================================
      SAME REASON
    =================================================== */

    if (studentReason === teacherReason) {

      lesson.status = "problem";

      lesson.finalCompletionStatus = "incomplete";

      lesson.reviewStatus = "under_admin_review";

      lesson.disputeFlag = false;

      studentSubmission.reviewStatus =
        "under_admin_review";

      teacherSubmission.reviewStatus =
        "under_admin_review";

      await lesson.save();

      await studentSubmission.save();

      await teacherSubmission.save();

      return res.status(201).json({
        status: "success",

        message:
          "Both parties reported the same problem. The lesson has been submitted for admin review.",

        data: {
          submission,

          lessonStatus: {
            status: lesson.status,

            finalCompletionStatus:
              lesson.finalCompletionStatus,

            reviewStatus:
              lesson.reviewStatus,

            disputeFlag:
              lesson.disputeFlag,
          },
        },
      });
    }


    /* ===================================================
      DIFFERENT REASONS
    =================================================== */

    lesson.status = "problem";

    lesson.finalCompletionStatus = "incomplete";

    lesson.reviewStatus = "disputed";

    lesson.disputeFlag = true;

    studentSubmission.reviewStatus =
      "disputed";

    teacherSubmission.reviewStatus =
      "disputed";

    await lesson.save();

    await studentSubmission.save();

    await teacherSubmission.save();

    return res.status(201).json({
      status: "success",

      message:
        "Both parties reported different problems. The lesson has been marked as disputed.",

      data: {
        submission,

        lessonStatus: {
          status: lesson.status,

          finalCompletionStatus:
            lesson.finalCompletionStatus,

          reviewStatus:
            lesson.reviewStatus,

          disputeFlag:
            lesson.disputeFlag,
        },
      },
    });
  }


  /* =====================================================
    CASE C
    ONE COMPLETED + ONE INCOMPLETE
  ===================================================== */

  /*
    Regardless of who reported what,
    conflicting completion statuses mean
    the lesson must be reviewed.
  */

  if (
    (
      studentStatus === "completed" &&
      teacherStatus === "incomplete"
    ) ||
    (
      studentStatus === "incomplete" &&
      teacherStatus === "completed"
    )
  ) {

    lesson.status = "problem";

    lesson.finalCompletionStatus = "incomplete";

    lesson.reviewStatus = "disputed";

    lesson.disputeFlag = true;

    studentSubmission.reviewStatus =
      "disputed";

    teacherSubmission.reviewStatus =
      "disputed";

    await lesson.save();

    await studentSubmission.save();

    await teacherSubmission.save();

    return res.status(201).json({
      status: "success",

      message:
        "The parties provided conflicting completion results. The lesson has been marked as disputed.",

      data: {
        submission,

        lessonStatus: {
          status: lesson.status,

          finalCompletionStatus:
            lesson.finalCompletionStatus,

          reviewStatus:
            lesson.reviewStatus,

          disputeFlag:
            lesson.disputeFlag,
        },
      },
    });
  }


  /* =====================================================
     13. COMPLETED CONFIRMATION
  ===================================================== */

  /*
    IMPORTANT:

    "completed" here means:
    This user has no problem with the lesson.

    It does NOT change finalCompletionStatus.

    The lesson completion itself is handled by
    the lesson completion Cron.
  */

  return res.status(201).json({
    status: "success",

    message:
      "Your completion confirmation has been recorded successfully.",

    data: {
      submission,

      lessonStatus: {
        status: lesson.status,
        finalCompletionStatus:
          lesson.finalCompletionStatus,
        reviewStatus:
          lesson.reviewStatus,
        disputeFlag:
          lesson.disputeFlag,
      },
    },
  });
});

exports.getDisputedLessons = asyncHandler(async (req, res, next) => {

  /* =====================================================
     1. ADMIN ONLY
  ===================================================== */

  if (req.user.role !== "admin") {
    return next(
      new ApiError("Not authorized", 403)
    );
  }

  /* =====================================================
     2. PAGINATION
  ===================================================== */

  const page = Math.max(
    1,
    Number(req.query.page) || 1
  );

  const limit = Math.min(
    50,
    Math.max(
      1,
      Number(req.query.limit) || 10
    )
  );

  const skip = (page - 1) * limit;

  /* =====================================================
     3. FILTERS
  ===================================================== */

  const {
    reviewStatus,
    from,
    to,
    subject,
    paymentStatus,
    sort,
  } = req.query;

  /* =====================================================
     4. BASE FILTER
  ===================================================== */

  const match = {
    status: "problem",

    reviewStatus: {
      $in: [
        "disputed",
        "under_admin_review",
      ],
    },
  };

  /* =====================================================
     5. REVIEW STATUS FILTER
  ===================================================== */

  if (reviewStatus) {

    if (
      ![
        "disputed",
        "under_admin_review",
      ].includes(reviewStatus)
    ) {
      return next(
        new ApiError(
          "Invalid reviewStatus",
          400
        )
      );
    }

    match.reviewStatus = reviewStatus;
  }

  /* =====================================================
     6. SUBJECT FILTER
  ===================================================== */

  if (subject) {
    match.subject = subject;
  }

  /* =====================================================
     7. PAYMENT STATUS FILTER
  ===================================================== */

  if (paymentStatus) {

    const allowedPaymentStatuses = [
      "unpaid",
      "pending",
      "paid",
      "released",
      "refunded",
      "refund_pending",
    ];

    if (
      !allowedPaymentStatuses.includes(
        paymentStatus
      )
    ) {
      return next(
        new ApiError(
          "Invalid paymentStatus",
          400
        )
      );
    }

    match.paymentStatus =
      paymentStatus;
  }

  /* =====================================================
     8. DATE FILTER
  ===================================================== */

  if (from || to) {

    match.createdAt = {};

    if (from) {

      const fromDate =
        new Date(from);

      if (
        Number.isNaN(
          fromDate.getTime()
        )
      ) {
        return next(
          new ApiError(
            "Invalid from date",
            400
          )
        );
      }

      match.createdAt.$gte =
        fromDate;
    }

    if (to) {

      const toDate =
        new Date(to);

      if (
        Number.isNaN(
          toDate.getTime()
        )
      ) {
        return next(
          new ApiError(
            "Invalid to date",
            400
          )
        );
      }

      /*
        Make the "to" date inclusive
        when only YYYY-MM-DD is sent.
      */

      if (
        /^\d{4}-\d{2}-\d{2}$/.test(to)
      ) {
        toDate.setHours(
          23,
          59,
          59,
          999
        );
      }

      match.createdAt.$lte =
        toDate;
    }
  }

  /* =====================================================
     9. SORT
  ===================================================== */

  const sortOption =
    sort === "oldest"
      ? { createdAt: 1 }
      : { createdAt: -1 };

  /* =====================================================
     10. GET DATA + TOTAL
  ===================================================== */

  const [lessons, total] =
    await Promise.all([

      Lesson.find(match)
        .populate({
          path: "student",
          select:
            "firstName lastName email imageProfile phone",
        })
        .populate({
          path: "acceptedTeacher",
          select:
            "firstName lastName email imageProfile phone teacherProfile",
        })
        .select(
          [
            "student",
            "acceptedTeacher",
            "title",
            "subject",
            "price",
            "requestedDate",
            "durationInMinutes",
            "status",
            "paymentStatus",
            "paymentId",
            "fundsStatus",
            "finalCompletionStatus",
            "reviewStatus",
            "disputeFlag",
            "studentConfirmed",
            "teacherConfirmed",
            "meetingStartTime",
            "meetingEndTime",
            "createdAt",
            "updatedAt",
          ].join(" ")
        )
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),

      Lesson.countDocuments(match),

    ]);

  /* =====================================================
     11. RESPONSE
  ===================================================== */

  res.status(200).json({

    status: "success",

    page,

    limit,

    total,

    totalPages:
      Math.ceil(total / limit),

    hasNextPage:
      page * limit < total,

    hasPrevPage:
      page > 1,

    results:
      lessons.length,

    data: lessons,
  });
});

exports.adminResolveLesson = asyncHandler(
  async (req, res, next) => {

    /* =====================================================
       1. ADMIN ONLY
    ===================================================== */

    if (req.user.role !== "admin") {
      return next(
        new ApiError(
          "Not authorized",
          403
        )
      );
    }


    /* =====================================================
       2. INPUT
    ===================================================== */

    const { lessonId } =
      req.params;

    const {
      finalStatus,
      adminNote,
    } = req.body;


    /* =====================================================
       3. VALIDATE FINAL STATUS
    ===================================================== */

    if (
      !["completed", "incomplete"].includes(
        finalStatus
      )
    ) {
      return next(
        new ApiError(
          "finalStatus must be either completed or incomplete",
          400
        )
      );
    }


    /* =====================================================
       4. START TRANSACTION
    ===================================================== */

    const session =
      await mongoose.startSession();

    let finalLesson;
    let paymentDecision = null;

    try {

      await session.startTransaction();


      /* ===================================================
         5. GET LESSON
      =================================================== */

      const lesson =
        await Lesson.findById(
          lessonId
        ).session(session);

      if (!lesson) {
        throw new ApiError(
          "Lesson not found",
          404
        );
      }


      /* ===================================================
         6. CHECK REVIEW STATE
      =================================================== */

      if (
        ![
          "disputed",
          "under_admin_review",
        ].includes(
          lesson.reviewStatus
        )
      ) {
        throw new ApiError(
          "Lesson is not waiting for admin resolution",
          400
        );
      }


      /* ===================================================
         7. PREVENT INVALID REFUND
      =================================================== */

      if (
        finalStatus === "incomplete" &&
        (
          lesson.paymentStatus ===
            "released" ||
          lesson.fundsStatus ===
            "released"
        )
      ) {
        throw new ApiError(
          "Cannot resolve lesson as incomplete after payment has been released",
          400
        );
      }


      /* ===================================================
         8. ADMIN DECIDES COMPLETED
      =================================================== */

      if (
        finalStatus ===
        "completed"
      ) {

        /*
          Atomic state transition.

          Only a lesson still waiting for
          admin resolution can be updated.
        */

        const updatedLesson =
          await Lesson.findOneAndUpdate(
            {
              _id:
                lessonId,

              reviewStatus: {
                $in: [
                  "disputed",
                  "under_admin_review",
                ],
              },
            },
            {
              $set: {

                finalCompletionStatus:
                  "completed",

                reviewStatus:
                  "resolved_by_admin",

                disputeFlag:
                  false,

                status:
                  "completed",
              },
            },
            {
              new: true,
              session,
            }
          );


        if (!updatedLesson) {
          throw new ApiError(
            "This lesson has already been resolved",
            409
          );
        }


        /* ===============================================
           UPDATE SUBMISSIONS
        =============================================== */

        await CompleteLesson.updateMany(
          {
            lesson:
              lessonId,
          },
          {
            $set: {

              "adminReview.status":
                "approved",

              "adminReview.reviewedBy":
                req.user._id,

              "adminReview.reviewedAt":
                new Date(),

              "adminReview.adminNote":
                adminNote?.trim() ||
                null,

              reviewStatus:
                "resolved_by_admin",
            },
          },
          {
            session,
          }
        );


        /* ===============================================
           PAYMENT
        =============================================== */

        /*
          Student confirmation is required
          before release.
        */

        if (
          updatedLesson.paymentStatus ===
            "paid" &&

          updatedLesson.fundsStatus ===
            "holding" &&

          updatedLesson.studentConfirmed ===
            true
        ) {

          /*
            IMPORTANT:

            handleLessonCompletion must accept
            this session.

            This prevents a nested transaction.
          */

          const result =
            await handleLessonCompletion(
              updatedLesson._id,
              {
                session,
                skipTeacherConfirmation:
                  true,
              }
            );

          paymentDecision =
            result.decision;

        } else {

          paymentDecision =
            "waiting_student_confirmation";
        }


        finalLesson =
          updatedLesson;
      }


      /* ===================================================
         9. ADMIN DECIDES INCOMPLETE
      =================================================== */

      if (
        finalStatus ===
        "incomplete"
      ) {

        /*
          First update the lesson and submissions
          inside the same transaction.
        */

        const updatedLesson =
          await Lesson.findOneAndUpdate(
            {
              _id:
                lessonId,

              reviewStatus: {
                $in: [
                  "disputed",
                  "under_admin_review",
                ],
              },
            },
            {
              $set: {

                finalCompletionStatus:
                  "incomplete",

                reviewStatus:
                  "resolved_by_admin",

                disputeFlag:
                  false,

                status:
                  "problem",
              },
            },
            {
              new: true,
              session,
            }
          );


        if (!updatedLesson) {
          throw new ApiError(
            "This lesson has already been resolved",
            409
          );
        }


        /* ===============================================
           UPDATE SUBMISSIONS
        =============================================== */

        await CompleteLesson.updateMany(
          {
            lesson:
              lessonId,
          },
          {
            $set: {

              "adminReview.status":
                "rejected",

              "adminReview.reviewedBy":
                req.user._id,

              "adminReview.reviewedAt":
                new Date(),

              "adminReview.adminNote":
                adminNote?.trim() ||
                null,

              reviewStatus:
                "resolved_by_admin",
            },
          },
          {
            session,
          }
        );


        /* ===============================================
           REFUND
        =============================================== */

        if (
          updatedLesson.paymentStatus ===
            "paid" &&

          updatedLesson.fundsStatus ===
            "holding"
        ) {

          const refundResult =
            await handleRefund({
              lessonId:
                updatedLesson._id,

              reason:
                adminNote?.trim() ||
                "Lesson resolved as incomplete by admin",

              requestedBy:
                req.user._id,

              /*
                IMPORTANT:
                no canceledBy here.
                This is an admin dispute resolution,
                not a student/teacher cancellation.
              */

              session,
            });


          paymentDecision =
            refundResult.refundStatus;

        } else if (
          updatedLesson.paymentStatus ===
            "refund_pending" ||
          updatedLesson.fundsStatus ===
            "refund_pending"
        ) {

          paymentDecision =
            "already_refund_pending";

        } else if (
          updatedLesson.paymentStatus ===
            "refunded" ||
          updatedLesson.fundsStatus ===
            "refunded"
        ) {

          paymentDecision =
            "already_refunded";

        } else if (
          updatedLesson.paymentStatus ===
            "unpaid"
        ) {

          paymentDecision =
            "no_refund_required";

        } else {

          throw new ApiError(
            "Lesson payment is not eligible for refund",
            400
          );
        }


        finalLesson =
          updatedLesson;
      }


      /* ===================================================
         10. COMMIT
      =================================================== */

      await session.commitTransaction();


      /* ===================================================
         11. GET FINAL STATE
      =================================================== */

      finalLesson =
        await Lesson.findById(
          lessonId
        ).lean();


    } catch (err) {

      await session.abortTransaction();

      throw err;

    } finally {

      await session.endSession();
    }


    /* =====================================================
       12. RESPONSE
    ===================================================== */

    return res.status(200).json({

      status: "success",

      message:
        finalStatus === "completed"
          ? "Lesson resolved as completed successfully."
          : "Lesson resolved as incomplete successfully.",

      data: {

        lessonId:
          finalLesson._id,

        status:
          finalLesson.status,

        finalCompletionStatus:
          finalLesson.finalCompletionStatus,

        reviewStatus:
          finalLesson.reviewStatus,

        disputeFlag:
          finalLesson.disputeFlag,

        studentConfirmed:
          finalLesson.studentConfirmed,

        teacherConfirmed:
          finalLesson.teacherConfirmed,

        paymentStatus:
          finalLesson.paymentStatus,

        fundsStatus:
          finalLesson.fundsStatus,

        paymentDecision,

        adminNote:
          adminNote?.trim() ||
          null,
      },
    });
  }
);



// =======================================================
// GET PAST LESSONS FOR TEACHER/STUDENT COMPLETED WITHOUT ISSUES
// =======================================================
exports.getPastCompletedLessons = asyncHandler(async (req, res, next) => {

    /* =====================================================
       1. USER
    ===================================================== */

    const user = req.user;

    /* =====================================================
       2. PAGINATION
    ===================================================== */

    const page = Math.max(
      1,
      Number(req.query.page) || 1
    );

    const limit = Math.min(
      50,
      Math.max(
        1,
        Number(req.query.limit) || 10
      )
    );

    const skip =
      (page - 1) * limit;


    /* =====================================================
       3. QUERY PARAMS
    ===================================================== */

    const {
      subject,
      from,
      to,
      minPrice,
      maxPrice,
      sort,
      reviewed,
    } = req.query;


    /* =====================================================
       4. ROLE FILTER
    ===================================================== */

    const match = {
      // A finished meeting remains in this list while both parties submit
      // their outcome. It becomes fully completed only after both confirm.
      finalCompletionStatus: {
        $in: ["pending", "completed"],
      },
      meetingEndTime: {
        $ne: null,
      },
    };


    /* =====================================================
       5. USER OWNERSHIP
    ===================================================== */

    if (user.role === "student") {

      match.student =
        user._id;

    } else if (user.role === "teacher") {

      match.acceptedTeacher =
        user._id;

    } else {

      return next(
        new ApiError(
          "You are not authorized to access past completed lessons",
          403
        )
      );
    }


    /* =====================================================
       6. SUBJECT FILTER
    ===================================================== */

    if (subject) {
      match.subject = subject;
    }


    /* =====================================================
       7. DATE FILTER
    ===================================================== */

    if (from || to) {

      const meetingEndFilter = {};


      if (from) {

        const fromDate =
          new Date(from);

        if (
          Number.isNaN(
            fromDate.getTime()
          )
        ) {
          return next(
            new ApiError(
              "Invalid 'from' date",
              400
            )
          );
        }

        meetingEndFilter.$gte =
          fromDate;
      }


      if (to) {

        const toDate =
          new Date(to);

        if (
          Number.isNaN(
            toDate.getTime()
          )
        ) {
          return next(
            new ApiError(
              "Invalid 'to' date",
              400
            )
          );
        }

        /*
          If the frontend sends only a date,
          make the 'to' date inclusive.
        */

        if (
          /^\d{4}-\d{2}-\d{2}$/.test(to)
        ) {
          toDate.setHours(
            23,
            59,
            59,
            999
          );
        }

        meetingEndFilter.$lte =
          toDate;
      }


      match.meetingEndTime =
        meetingEndFilter;
    }


    /* =====================================================
       8. PRICE FILTER
    ===================================================== */

    if (
      minPrice !== undefined ||
      maxPrice !== undefined
    ) {

      const priceFilter = {};


      if (
        minPrice !== undefined
      ) {

        const min =
          Number(minPrice);

        if (
          Number.isNaN(min) ||
          min < 0
        ) {
          return next(
            new ApiError(
              "Invalid minPrice",
              400
            )
          );
        }

        priceFilter.$gte =
          min;
      }


      if (
        maxPrice !== undefined
      ) {

        const max =
          Number(maxPrice);

        if (
          Number.isNaN(max) ||
          max < 0
        ) {
          return next(
            new ApiError(
              "Invalid maxPrice",
              400
            )
          );
        }

        priceFilter.$lte =
          max;
      }


      if (
        priceFilter.$gte !== undefined &&
        priceFilter.$lte !== undefined &&
        priceFilter.$gte >
          priceFilter.$lte
      ) {
        return next(
          new ApiError(
            "minPrice cannot be greater than maxPrice",
            400
          )
        );
      }


      match.price =
        priceFilter;
    }


    /* =====================================================
       9. REVIEW FILTER VALIDATION
    ===================================================== */

    if (
      reviewed !== undefined &&
      !["true", "false"].includes(
        reviewed
      )
    ) {
      return next(
        new ApiError(
          "reviewed must be true or false",
          400
        )
      );
    }


    /* =====================================================
       10. SORT
    ===================================================== */

    /*
      Only allow known sortable fields.
    */

    const allowedSortFields = {

      date:
        "meetingEndTime",

      price:
        "price",

      duration:
        "durationInMinutes",

      created:
        "createdAt",
    };


    let sortField =
      "meetingEndTime";

    let sortDirection =
      -1;


    if (sort) {

      /*
        Supported formats:

        ?sort=date
        ?sort=price
        ?sort=duration
        ?sort=created

        Optional descending:

        ?sort=-price
        ?sort=-duration
      */

      const isDescending =
        sort.startsWith("-");

      const requestedSort =
        isDescending
          ? sort.substring(1)
          : sort;


      if (
        allowedSortFields[
          requestedSort
        ]
      ) {

        sortField =
          allowedSortFields[
            requestedSort
          ];

        sortDirection =
          isDescending
            ? -1
            : 1;

      } else {

        return next(
          new ApiError(
            "Invalid sort field",
            400
          )
        );
      }
    }


    /* =====================================================
       11. AGGREGATION
    ===================================================== */

    const pipeline = [

      /* ================================================
         MATCH
      ================================================ */

      {
        $match:
          match,
      },


      /* ================================================
         LOOKUP REVIEWS
      ================================================ */

      {
        $lookup: {

          from:
            "reviews",

          localField:
            "_id",

          foreignField:
            "lesson",

          as:
            "reviews",
        },
      },


      /* ================================================
         REVIEW FLAG
      ================================================ */

      {
        $addFields: {

          hasReview: {
            $gt: [
              {
                $size:
                  "$reviews",
              },
              0,
            ],
          },
        },
      },


      /* ================================================
         REVIEW FILTER
      ================================================ */

      ...(reviewed === "true"
        ? [
            {
              $match: {
                hasReview:
                  true,
              },
            },
          ]
        : []),

      ...(reviewed === "false"
        ? [
            {
              $match: {
                hasReview:
                  false,
              },
            },
          ]
        : []),


      /* ================================================
         STUDENT
      ================================================ */

      {
        $lookup: {

          from:
            "users",

          localField:
            "student",

          foreignField:
            "_id",

          as:
            "student",
        },
      },


      {
        $unwind: {

          path:
            "$student",

          preserveNullAndEmptyArrays:
            false,
        },
      },


      /* ================================================
         TEACHER
      ================================================ */

      {
        $lookup: {

          from:
            "users",

          localField:
            "acceptedTeacher",

          foreignField:
            "_id",

          as:
            "acceptedTeacher",
        },
      },


      {
        $unwind: {

          path:
            "$acceptedTeacher",

          /*
            Do not lose a completed lesson
            if teacher data is missing.
          */

          preserveNullAndEmptyArrays:
            true,
        },
      },


      /* ================================================
         REVIEW
         Take first review
      ================================================ */

      {
        $addFields: {

          review: {
            $arrayElemAt: [
              "$reviews",
              0,
            ],
          },
        },
      },


      /* ================================================
         SORT
      ================================================ */

      {
        $sort: {
          [sortField]:
            sortDirection,

          /*
            Stable secondary sort.
          */

          _id:
            -1,
        },
      },


      /* ================================================
         FACET
      ================================================ */

      {
        $facet: {

          /* ==========================================
             DATA
          ========================================== */

          data: [

            {
              $skip:
                skip,
            },

            {
              $limit:
                limit,
            },

            {
              $project: {

                _id:
                  1,

                title:
                  1,

                subject:
                  1,

                price:
                  1,

                durationInMinutes:
                  1,

                requestedDate:
                  1,

                meetingStartTime:
                  1,

                meetingEndTime:
                  1,

                finalCompletionStatus:
                  1,

                reviewStatus:
                  1,

                paymentStatus:
                  1,

                fundsStatus:
                  1,

                hasReview:
                  1,


                /* =========================
                   STUDENT
                ========================= */

                student: {

                  _id:
                    "$student._id",

                  firstName:
                    "$student.firstName",

                  lastName:
                    "$student.lastName",

                  email:
                    "$student.email",

                  imageProfile:
                    "$student.imageProfile",

                  studentProfile:
                    "$student.studentProfile",
                },


                /* =========================
                   TEACHER
                ========================= */

                acceptedTeacher: {

                  _id:
                    "$acceptedTeacher._id",

                  firstName:
                    "$acceptedTeacher.firstName",

                  lastName:
                    "$acceptedTeacher.lastName",

                  email:
                    "$acceptedTeacher.email",

                  imageProfile:
                    "$acceptedTeacher.imageProfile",

                  avgRating:
                    "$acceptedTeacher.teacherProfile.avgRating",
                },


                /* =========================
                   REVIEW
                ========================= */

                review: {

                  _id:
                    "$review._id",

                  rating:
                    "$review.rating",

                  comment:
                    "$review.comment",

                  createdAt:
                    "$review.createdAt",

                  student:
                    "$review.student",

                  teacher:
                    "$review.teacher",
                },
              },
            },
          ],


          /* ==========================================
             TOTAL
          ========================================== */

          metadata: [
            {
              $count:
                "total",
            },
          ],
        },
      },
    ];


    /* =====================================================
       12. EXECUTE
    ===================================================== */

    const result =
      await Lesson.aggregate(
        pipeline
      );


    const data =
      result[0]?.data || [];


    const total =
      result[0]?.metadata?.[0]?.total || 0;


    /* =====================================================
       13. RESPONSE
    ===================================================== */

    return res.status(200).json({

      status:
        "success",

      page,

      limit,

      total,

      totalPages:
        Math.ceil(
          total / limit
        ),

      hasNextPage:
        page * limit <
        total,

      hasPrevPage:
        page > 1,

      results:
        data.length,

      data,
    });
  }
);


// =======================================================
// GET past lessons with issues (problem, disputed, under_admin_review) FOR TEACHER/STUDENT
// =======================================================

exports.getProblematicPastLessons = asyncHandler(async (req, res, next) => {

    /* =====================================================
       1. USER
    ===================================================== */

    const userId = req.user._id;


    /* =====================================================
       2. PAGINATION
    ===================================================== */

    const page = Math.max(
      1,
      Number(req.query.page) || 1
    );

    const limit = Math.min(
      50,
      Math.max(
        1,
        Number(req.query.limit) || 10
      )
    );

    const skip =
      (page - 1) * limit;


    /* =====================================================
       3. QUERY PARAMS
    ===================================================== */

    const {
      reviewStatus,
      from,
      to,
    } = req.query;


    /* =====================================================
       4. BASE MATCH
    ===================================================== */

    const match = {

      /*
        A lesson is considered problematic if
        ANY of these conditions is true.
      */

      $and: [

        {
          $or: [

            {
              status:
                "problem",
            },

            {
              finalCompletionStatus:
                "incomplete",
            },

            {
              reviewStatus: {
                $in: [
                  "disputed",
                  "under_admin_review",
                  "resolved_by_admin",
                ],
              },
            },

            {
              disputeFlag:
                true,
            },
          ],
        },


        /*
          Only lessons belonging to
          the logged-in student or teacher.
        */

        {
          $or: [
            {
              student:
                userId,
            },

            {
              acceptedTeacher:
                userId,
            },
          ],
        },
      ],
    };


    /* =====================================================
       5. REVIEW STATUS FILTER
    ===================================================== */

    if (reviewStatus) {

      const allowedReviewStatuses = [
        "waiting_second_party",
        "auto_resolved",
        "disputed",
        "under_admin_review",
        "resolved_by_admin",
      ];

      if (
        !allowedReviewStatuses.includes(
          reviewStatus
        )
      ) {
        return next(
          new ApiError(
            "Invalid reviewStatus",
            400
          )
        );
      }

      match.reviewStatus =
        reviewStatus;
    }


    /* =====================================================
       6. DATE FILTER
    ===================================================== */

    if (from || to) {

      const createdAtFilter = {};


      if (from) {

        const fromDate =
          new Date(from);

        if (
          Number.isNaN(
            fromDate.getTime()
          )
        ) {
          return next(
            new ApiError(
              "Invalid 'from' date",
              400
            )
          );
        }

        createdAtFilter.$gte =
          fromDate;
      }


      if (to) {

        const toDate =
          new Date(to);

        if (
          Number.isNaN(
            toDate.getTime()
          )
        ) {
          return next(
            new ApiError(
              "Invalid 'to' date",
              400
            )
          );
        }

        /*
          Make date-only "to" inclusive.
        */

        if (
          /^\d{4}-\d{2}-\d{2}$/.test(
            to
          )
        ) {
          toDate.setHours(
            23,
            59,
            59,
            999
          );
        }

        createdAtFilter.$lte =
          toDate;
      }


      match.createdAt =
        createdAtFilter;
    }


    /* =====================================================
       7. PIPELINE
    ===================================================== */

    const pipeline = [

      /* ===================================================
         MATCH
      =================================================== */

      {
        $match:
          match,
      },


      /* ===================================================
         REVIEW
      =================================================== */

      {
        $lookup: {

          from:
            "reviews",

          localField:
            "_id",

          foreignField:
            "lesson",

          as:
            "review",
        },
      },


      {
        $addFields: {

          review: {
            $arrayElemAt: [
              "$review",
              0,
            ],
          },
        },
      },


      /* ===================================================
         COMPLETION SUBMISSIONS
      =================================================== */

      {
        $lookup: {

          from:
            "completelessons",

          localField:
            "_id",

          foreignField:
            "lesson",

          as:
            "submissions",
        },
      },


      /* ===================================================
         GET STUDENT + TEACHER SUBMISSIONS
      =================================================== */

      {
        $addFields: {

          studentSubmission: {

            $arrayElemAt: [

              {
                $filter: {

                  input:
                    "$submissions",

                  as:
                    "submission",

                  cond: {
                    $eq: [
                      "$$submission.role",
                      "student",
                    ],
                  },
                },
              },

              0,
            ],
          },


          teacherSubmission: {

            $arrayElemAt: [

              {
                $filter: {

                  input:
                    "$submissions",

                  as:
                    "submission",

                  cond: {
                    $eq: [
                      "$$submission.role",
                      "teacher",
                    ],
                  },
                },
              },

              0,
            ],
          },
        },
      },


      /* ===================================================
         DETERMINE CURRENT PROBLEM STATE
      =================================================== */

      {
        $addFields: {

          problemState: {

            $switch: {

              branches: [

                /* =========================================
                   BOTH SUBMISSIONS MISSING
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          {
                            $type:
                              "$studentSubmission",
                          },
                          "missing",
                        ],
                      },

                      {
                        $eq: [
                          {
                            $type:
                              "$teacherSubmission",
                          },
                          "missing",
                        ],
                      },
                    ],
                  },

                  then:
                    "waiting_submissions",
                },


                /* =========================================
                   ONLY ONE SUBMISSION
                ========================================= */

                {
                  case: {
                    $or: [

                      {
                        $eq: [
                          {
                            $type:
                              "$studentSubmission",
                          },
                          "missing",
                        ],
                      },

                      {
                        $eq: [
                          {
                            $type:
                              "$teacherSubmission",
                          },
                          "missing",
                        ],
                      },
                    ],
                  },

                  then:
                    "waiting_second_party",
                },


                /* =========================================
                   BOTH COMPLETED
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          "$studentSubmission.completionStatus",
                          "completed",
                        ],
                      },

                      {
                        $eq: [
                          "$teacherSubmission.completionStatus",
                          "completed",
                        ],
                      },
                    ],
                  },

                  then:
                    "both_completed",
                },


                /* =========================================
                   STUDENT COMPLETED
                   TEACHER INCOMPLETE
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          "$studentSubmission.completionStatus",
                          "completed",
                        ],
                      },

                      {
                        $eq: [
                          "$teacherSubmission.completionStatus",
                          "incomplete",
                        ],
                      },
                    ],
                  },

                  then:
                    "different_completion_status",
                },


                /* =========================================
                   STUDENT INCOMPLETE
                   TEACHER COMPLETED
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          "$studentSubmission.completionStatus",
                          "incomplete",
                        ],
                      },

                      {
                        $eq: [
                          "$teacherSubmission.completionStatus",
                          "completed",
                        ],
                      },
                    ],
                  },

                  then:
                    "different_completion_status",
                },


                /* =========================================
                   BOTH INCOMPLETE + SAME REASON
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          "$studentSubmission.completionStatus",
                          "incomplete",
                        ],
                      },

                      {
                        $eq: [
                          "$teacherSubmission.completionStatus",
                          "incomplete",
                        ],
                      },

                      {
                        $ne: [
                          "$studentSubmission.reasonForIncomplete",
                          null,
                        ],
                      },

                      {
                        $ne: [
                          "$teacherSubmission.reasonForIncomplete",
                          null,
                        ],
                      },

                      {
                        $eq: [
                          "$studentSubmission.reasonForIncomplete",
                          "$teacherSubmission.reasonForIncomplete",
                        ],
                      },
                    ],
                  },

                  then:
                    "same_reason",
                },


                /* =========================================
                   BOTH INCOMPLETE + DIFFERENT REASON
                ========================================= */

                {
                  case: {
                    $and: [

                      {
                        $eq: [
                          "$studentSubmission.completionStatus",
                          "incomplete",
                        ],
                      },

                      {
                        $eq: [
                          "$teacherSubmission.completionStatus",
                          "incomplete",
                        ],
                      },

                      {
                        $ne: [
                          "$studentSubmission.reasonForIncomplete",
                          null,
                        ],
                      },

                      {
                        $ne: [
                          "$teacherSubmission.reasonForIncomplete",
                          null,
                        ],
                      },

                      {
                        $ne: [
                          "$studentSubmission.reasonForIncomplete",
                          "$teacherSubmission.reasonForIncomplete",
                        ],
                      },
                    ],
                  },

                  then:
                    "different_reason",
                },
              ],


              default:
                "problem_detected",
            },
          },
        },
      },


      /* ===================================================
         HUMAN READABLE DISPUTE REASON
      =================================================== */

      {
        $addFields: {

          disputeReason: {

            $switch: {

              branches: [

                /* =========================================
                   WAITING SECOND PARTY
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$problemState",
                      "waiting_second_party",
                    ],
                  },

                  then:
                    "Waiting for the second party to submit completion status.",
                },


                /* =========================================
                   BOTH COMPLETED
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$problemState",
                      "both_completed",
                    ],
                  },

                  then:
                    "Both student and teacher reported that the lesson was completed.",
                },


                /* =========================================
                   DIFFERENT COMPLETION STATUS
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$problemState",
                      "different_completion_status",
                    ],
                  },

                  then:
                    "Student and teacher reported different completion statuses.",
                },


                /* =========================================
                   SAME REASON
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$problemState",
                      "same_reason",
                    ],
                  },

                  then:
                    "Student and teacher reported the same reason for the incomplete lesson.",
                },


                /* =========================================
                   DIFFERENT REASON
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$problemState",
                      "different_reason",
                    ],
                  },

                  then:
                    "Student and teacher reported different reasons for the incomplete lesson.",
                },


                /* =========================================
                   UNDER ADMIN REVIEW
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$reviewStatus",
                      "under_admin_review",
                    ],
                  },

                  then:
                    "Waiting for admin review.",
                },


                /* =========================================
                   RESOLVED
                ========================================= */

                {
                  case: {
                    $eq: [
                      "$reviewStatus",
                      "resolved_by_admin",
                    ],
                  },

                  then:
                    "Resolved by administrator.",
                },
              ],


              default:
                "Problem detected.",
            },
          },
        },
      },


      /* ===================================================
         POPULATE STUDENT
      =================================================== */

      {
        $lookup: {

          from:
            "users",

          localField:
            "student",

          foreignField:
            "_id",

          as:
            "student",
        },
      },


      {
        $unwind:
          "$student",
      },


      /* ===================================================
         POPULATE TEACHER
      =================================================== */

      {
        $lookup: {

          from:
            "users",

          localField:
            "acceptedTeacher",

          foreignField:
            "_id",

          as:
            "acceptedTeacher",
        },
      },


      {
        $unwind: {

          path:
            "$acceptedTeacher",

          preserveNullAndEmptyArrays:
            true,
        },
      },


      /* ===================================================
         SORT
      =================================================== */

      {
        $sort: {
          createdAt:
            -1,

          _id:
            -1,
        },
      },


      /* ===================================================
         FACET
      =================================================== */

      {
        $facet: {

          /* ===============================================
             TOTAL
          =============================================== */

          metadata: [

            {
              $count:
                "total",
            },
          ],


          /* ===============================================
             DATA
          =============================================== */

          data: [

            {
              $skip:
                skip,
            },

            {
              $limit:
                limit,
            },


            /* =============================================
               PROJECT
            ============================================= */

            {
              $project: {

                _id:
                  1,

                title:
                  1,

                subject:
                  1,

                price:
                  1,

                requestedDate:
                  1,

                durationInMinutes:
                  1,

                meetingStartTime:
                  1,

                meetingEndTime:
                  1,

                status:
                  1,

                reviewStatus:
                  1,

                finalCompletionStatus:
                  1,

                disputeFlag:
                  1,

                disputeReason:
                  1,

                problemState:
                  1,


                /* =======================================
                   REVIEW
                ======================================= */

                review:
                  1,


                /* =======================================
                   STUDENT
                ======================================= */

                student: {

                  _id:
                    "$student._id",

                  firstName:
                    "$student.firstName",

                  lastName:
                    "$student.lastName",

                  email:
                    "$student.email",

                  imageProfile:
                    "$student.imageProfile",
                },


                /* =======================================
                   TEACHER
                ======================================= */

                acceptedTeacher: {

                  _id:
                    "$acceptedTeacher._id",

                  firstName:
                    "$acceptedTeacher.firstName",

                  lastName:
                    "$acceptedTeacher.lastName",

                  email:
                    "$acceptedTeacher.email",

                  imageProfile:
                    "$acceptedTeacher.imageProfile",
                },


                /* =======================================
                   STUDENT SUBMISSION
                ======================================= */

                studentSubmission: {

                  completionStatus:
                    "$studentSubmission.completionStatus",

                  reasonForIncomplete:
                    "$studentSubmission.reasonForIncomplete",

                  description:
                    "$studentSubmission.description",

                  proofImage:
                    "$studentSubmission.proofImage",

                  submittedAt:
                    "$studentSubmission.createdAt",

                  reviewStatus:
                    "$studentSubmission.reviewStatus",

                  adminReview:
                    "$studentSubmission.adminReview",
                },


                /* =======================================
                   TEACHER SUBMISSION
                ======================================= */

                teacherSubmission: {

                  completionStatus:
                    "$teacherSubmission.completionStatus",

                  reasonForIncomplete:
                    "$teacherSubmission.reasonForIncomplete",

                  description:
                    "$teacherSubmission.description",

                  proofImage:
                    "$teacherSubmission.proofImage",

                  submittedAt:
                    "$teacherSubmission.createdAt",

                  reviewStatus:
                    "$teacherSubmission.reviewStatus",

                  adminReview:
                    "$teacherSubmission.adminReview",
                },


                /* =======================================
                   ACTUAL REASON
                ======================================= */

                sameReason: {

                  $cond: [

                    {
                      $eq: [
                        "$problemState",
                        "same_reason",
                      ],
                    },

                    "$studentSubmission.reasonForIncomplete",

                    null,
                  ],
                },


                reasonsMatch: {

                  $cond: [

                    {
                      $in: [
                        "$problemState",
                        [
                          "same_reason",
                          "different_reason",
                        ],
                      ],
                    },

                    {
                      $eq: [
                        "$studentSubmission.reasonForIncomplete",
                        "$teacherSubmission.reasonForIncomplete",
                      ],
                    },

                    null,
                  ],
                },
              },
            },
          ],
        },
      },
    ];


    /* =====================================================
       8. EXECUTE
    ===================================================== */

    const result =
      await Lesson.aggregate(
        pipeline
      );


    const data =
      result[0]?.data || [];


    const total =
      result[0]?.metadata?.[0]?.total || 0;


    /* =====================================================
       9. RESPONSE
    ===================================================== */

    return res.status(200).json({

      status:
        "success",

      page,

      limit,

      total,

      totalPages:
        Math.ceil(
          total / limit
        ),

      hasNextPage:
        page * limit <
        total,

      hasPrevPage:
        page > 1,

      results:
        data.length,

      data,
    });
  }
);

exports.getExpiredLessons = asyncHandler(async (req, res, next) => {
  const user = req.user;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const skip = (page - 1) * limit;

  const { subject, from, to, sort } = req.query;

  const now = new Date();

  /* =====================================
     BASE FILTER
  ===================================== */

  const match = {
    meetingStartTime: null,

    status: {
      $in: ["pending", "approved", "expired"],
    },
  };

  /* =====================================
     USER ROLE
  ===================================== */

  if (user.role === "student") {
    match.student = user._id;
  } else if (user.role === "teacher") {
    match.acceptedTeacher = user._id;

    match.status = {
      $in: ["approved", "expired"],
    };
  } else {
    return next(
      new ApiError("Not authorized", 403)
    );
  }

  /* =====================================
     SUBJECT
  ===================================== */

  if (subject) {
    match.subject = subject;
  }

  /* =====================================
     PIPELINE
  ===================================== */

  const pipeline = [
    {
      $match: match,
    },

    /* =====================================
       CALCULATE EXPIRATION TIME
    ===================================== */

    {
      $addFields: {
        expireAt: {
          $cond: [
            /*
              ================================
              URGENT / INSTANT LESSON
              ================================

              requestedDate = request time

              Expire after 6 hours if the
              lesson never started.
            */

            "$isUrgent",

            {
              $add: [
                "$requestedDate",
                6 * 60 * 60 * 1000,
              ],
            },

            /*
              ================================
              NORMAL SCHEDULED LESSON
              ================================

              requestedDate
              +
              duration
              +
              15 minutes buffer
            */

            {
              $add: [
                "$requestedDate",

                {
                  $multiply: [
                    "$durationInMinutes",
                    60 * 1000,
                  ],
                },

                15 * 60 * 1000,
              ],
            },
          ],
        },
      },
    },

    /* =====================================
       EXPIRED ONLY
    ===================================== */

    {
      $match: {
        $expr: {
          $lt: ["$expireAt", now],
        },
      },
    },

    /* =====================================
       DATE FILTER
    ===================================== */

    ...(from || to
      ? [
          {
            $match: {
              requestedDate: {
                ...(from
                  ? {
                      $gte: new Date(from),
                    }
                  : {}),

                ...(to
                  ? {
                      $lte: new Date(to),
                    }
                  : {}),
              },
            },
          },
        ]
      : []),

    /* =====================================
       POPULATE STUDENT
    ===================================== */

    {
      $lookup: {
        from: "users",
        localField: "student",
        foreignField: "_id",
        as: "student",
      },
    },

    {
      $unwind: "$student",
    },

    /* =====================================
       POPULATE TEACHER
    ===================================== */

    {
      $lookup: {
        from: "users",
        localField: "acceptedTeacher",
        foreignField: "_id",
        as: "acceptedTeacher",
      },
    },

    {
      $unwind: {
        path: "$acceptedTeacher",
        preserveNullAndEmptyArrays: true,
      },
    },

    /* =====================================
       PROJECT
    ===================================== */

    {
      $project: {
        _id: 1,

        title: 1,
        subject: 1,
        price: 1,

        requestedDate: 1,
        durationInMinutes: 1,

        isUrgent: 1,

        meetingStartTime: 1,
        meetingEndTime: 1,

        expireAt: 1,

        status: 1,
        paymentStatus: 1,

        finalCompletionStatus: 1,
        reviewStatus: 1,

        /* Student */

        "student._id": 1,
        "student.firstName": 1,
        "student.lastName": 1,
        "student.email": 1,
        "student.imageProfile": 1,

        /* Teacher */

        "acceptedTeacher._id": 1,
        "acceptedTeacher.firstName": 1,
        "acceptedTeacher.lastName": 1,
        "acceptedTeacher.email": 1,
        "acceptedTeacher.imageProfile": 1,
      },
    },

    /* =====================================
       SORT
    ===================================== */

    {
      $sort: {
        requestedDate:
          sort === "desc" ? -1 : 1,
      },
    },

    /* =====================================
       PAGINATION + TOTAL
    ===================================== */

    {
      $facet: {
        metadata: [
          {
            $count: "total",
          },
        ],

        data: [
          {
            $skip: skip,
          },

          {
            $limit: limit,
          },
        ],
      },
    },
  ];

  /* =====================================
     EXECUTE
  ===================================== */

  const result =
    await Lesson.aggregate(pipeline);

  const lessons =
    result[0]?.data || [];

  const total =
    result[0]?.metadata?.[0]?.total || 0;

  /* =====================================
     RESPONSE
  ===================================== */

  res.status(200).json({
    status: "success",

    page,
    limit,

    total,

    totalPages:
      Math.ceil(total / limit),

    hasNextPage:
      page * limit < total,

    hasPrevPage:
      page > 1,

    results: lessons.length,

    data: lessons,
  });
});