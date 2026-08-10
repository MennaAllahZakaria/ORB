const cron = require("node-cron");
const Lesson = require("../models/lessonModel");
const User = require("../models/userModel");
const { addPoints } = require("../services/pointsService");
const Notification = require("../models/notificationModel");
const { decryptToken } = require("../utils/fcmToken");
const admin = require("../fireBase/admin");

const LESSON_DURATION_BUFFER = 5 * 60 * 1000; // 5 minutes

const sendLessonNotification = async (
  users,
  {
    titleEn,
    titleAr,
    bodyEn,
    bodyAr,
    type,
    lessonId,
  }
) => {
  for (const user of users) {
    if (!user || !user._id || !user.fcmToken) {
      continue;
    }

    const lang = user.preferredLang || "en";

    const title =
      lang === "ar"
        ? titleAr
        : titleEn;

    const body =
      lang === "ar"
        ? bodyAr
        : bodyEn;

    const token = decryptToken(user.fcmToken);

    if (!token) {
      continue;
    }

    try {
      await admin.messaging().send({
        token,

        notification: {
          title,
          body,
        },

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
      const code =
        err.errorInfo?.code ||
        err.code;

      console.error(
        "[FCM] Failed:",
        code || err.message
      );

      /*
        Remove invalid FCM token
      */

      if (
        code ===
          "messaging/registration-token-not-registered" ||
        code ===
          "messaging/invalid-registration-token"
      ) {
        console.error(
          "[FCM] Invalid token for:",
          user.email
        );

        await User.findByIdAndUpdate(
          user._id,
          {
            $unset: {
              fcmToken: 1,
            },
          }
        );
      }
    }
  }
};


/* =====================================================
   LESSON COMPLETION CRON
===================================================== */

exports.runLessonCompletionJob = () => {
  cron.schedule("*/15 * * * *", async () => {
    console.log("[CRON] Checking lesson completion...");

    try {
      const now = new Date();

      /* =================================================
         1. HANDLE ONGOING LESSONS
      ================================================= */

      const ongoingLessons = await Lesson.find({
        meetingStatus: "ongoing",
        meetingStartTime: { $ne: null },

        // Do not touch problematic lessons
        status: {
          $nin: ["problem", "canceled", "expired"],
        },

        finalCompletionStatus: {
          $ne: "incomplete",
        },

        disputeFlag: false,

        reviewStatus: {
          $nin: [
            "disputed",
            "under_admin_review",
            "resolved_by_admin",
          ],
        },
      }).populate("student acceptedTeacher");

      for (const lesson of ongoingLessons) {
        try {
          /* ===============================================
             SAFETY CHECK
          =============================================== */

          if (!lesson.meetingStartTime) {
            continue;
          }

          /*
            If a problem was reported while the cron
            was processing the lessons, don't finish it.
          */

          if (
            lesson.status === "problem" ||
            lesson.status === "canceled" ||
            lesson.status === "expired" ||
            lesson.finalCompletionStatus === "incomplete" ||
            lesson.disputeFlag === true ||
            [
              "disputed",
              "under_admin_review",
              "resolved_by_admin",
            ].includes(lesson.reviewStatus)
          ) {
            console.log(
              `[CRON] Skipping problematic lesson ${lesson._id}`
            );

            continue;
          }

          /* ===============================================
             CHECK PARTICIPANTS
          =============================================== */

          /*
            A lesson that never had both participants
            should NOT be treated as a normally completed
            lesson.

            It will be handled by the missed lesson logic
            below when appropriate.
          */

          if (
            !lesson.activeParticipants ||
            lesson.activeParticipants.length < 2
          ) {
            continue;
          }

          /* ===============================================
             CALCULATE EXPECTED END
          =============================================== */

          const startTime = new Date(
            lesson.meetingStartTime
          );

          const durationMs =
            (lesson.durationInMinutes || 60) *
            60 *
            1000;

          const expectedEndTime = new Date(
            startTime.getTime() + durationMs
          );

          const allowedEndTime = new Date(
            expectedEndTime.getTime() +
              LESSON_DURATION_BUFFER
          );

          /*
            Lesson has not finished yet.
          */

          if (now <= allowedEndTime) {
            continue;
          }

          /* ===============================================
             FINAL SAFETY CHECK
          =============================================== */

          const currentLesson = await Lesson.findOne({
            _id: lesson._id,

            meetingStatus: "ongoing",

            status: {
              $nin: [
                "problem",
                "canceled",
                "expired",
              ],
            },

            finalCompletionStatus: {
              $ne: "incomplete",
            },

            disputeFlag: false,

            reviewStatus: {
              $nin: [
                "disputed",
                "under_admin_review",
                "resolved_by_admin",
              ],
            },
          });

          /*
            Someone may have reported a problem between
            the first query and this update.
          */

          if (!currentLesson) {
            console.log(
              `[CRON] Lesson ${lesson._id} changed state. Skipping.`
            );

            continue;
          }

          /* ===============================================
             FINISH MEETING ONLY
          =============================================== */

          console.log(
            `[CRON] Finishing meeting ${lesson._id}`
          );

          /*
            IMPORTANT:

            We DO NOT set:

              finalCompletionStatus = "completed"

            We DO NOT set:

              reviewStatus = "auto_resolved"

            The lesson must wait for both participants
            to submit their completion status.
          */

          currentLesson.meetingEndTime = now;

          currentLesson.meetingStatus = "finished";

          /*
            Keep:

              finalCompletionStatus = "pending"

            until submitCompletion decides the result.
          */

          await currentLesson.save();

          /* ===============================================
             END NOTIFICATION
          =============================================== */

          if (!currentLesson.endNotificationSent) {
            await sendLessonNotification(
              [
                lesson.acceptedTeacher,
                lesson.student,
              ],
              {
                titleEn: "⏰ Lesson time has ended",
                titleAr: "⏰ انتهى وقت الحصة",

                bodyEn:
                  "The lesson time has ended. Please submit your lesson completion status.",
                
                bodyAr:
                  "انتهى وقت الحصة. يرجى تسجيل حالة إتمام الحصة.",

                type: "lesson_ended",
                lessonId: currentLesson._id,
              }
            );

            currentLesson.endNotificationSent = true;

            await currentLesson.save();
          }

        } catch (err) {
          console.error(
            `[CRON] Error processing ongoing lesson ${lesson._id}:`,
            err
          );
        }
      }

      /* =================================================
         2. HANDLE MISSED / UPCOMING LESSONS
      ================================================= */

      const missedLessons = await Lesson.find({
        status: "approved",

        meetingStatus: "upcoming",

        meetingStartTime: null,

        /*
          Do not touch lessons already reported
          as problematic.
        */

        finalCompletionStatus: {
          $ne: "incomplete",
        },

        disputeFlag: false,

        reviewStatus: {
          $nin: [
            "disputed",
            "under_admin_review",
            "resolved_by_admin",
          ],
        },
      }).populate("student acceptedTeacher");

      for (const lesson of missedLessons) {
        try {
          /* ===============================================
             SAFETY CHECK
          =============================================== */

          if (
            lesson.status === "problem" ||
            lesson.status === "canceled" ||
            lesson.status === "expired"
          ) {
            continue;
          }

          /* ===============================================
             CALCULATE EXPECTED END
          =============================================== */

          const durationMs =
            (lesson.durationInMinutes || 60) *
            60 *
            1000;

          /*
            For normal scheduled lessons:
              requestedDate = lesson start

            For urgent lessons:
              requestedDate may already be in the past,
              so we use updatedAt as the fallback reference.
          */

          let referenceTime = lesson.requestedDate;

          if (lesson.isUrgent) {
            referenceTime = lesson.updatedAt;
          }

          if (!referenceTime) {
            continue;
          }

          const expectedEndTime = new Date(
            new Date(referenceTime).getTime() +
              durationMs
          );

          /*
            Extra 30 minutes for urgent lessons
            to allow setup / negotiation.
          */

          const extraBuffer = lesson.isUrgent
            ? 30 * 60 * 1000
            : 0;

          const allowedEndTime = new Date(
            expectedEndTime.getTime() +
              LESSON_DURATION_BUFFER +
              extraBuffer
          );

          if (now <= allowedEndTime) {
            continue;
          }

          /* ===============================================
             MISSED LESSON
          =============================================== */

          console.log(
            `[CRON] Marking missed lesson ${lesson._id} as problem`
          );

          /*
            IMPORTANT:

            The lesson never started.

            Therefore it cannot be considered completed.

            We mark it as a problem and wait for the
            completion/problem workflow.
          */

          lesson.status = "problem";

          lesson.meetingStatus = "finished";

          lesson.finalCompletionStatus = "incomplete";

          /*
            IMPORTANT:

            No participant submitted a reason yet.

            Therefore we should NOT pretend that one party
            reported incomplete.

            We send it directly to admin review because
            there is no "second party" to wait for.
          */

          lesson.reviewStatus = "under_admin_review";

          lesson.disputeFlag = false;

          await lesson.save();

          /* ===============================================
             NOTIFICATION
          =============================================== */

          await sendLessonNotification(
            [
              lesson.acceptedTeacher,
              lesson.student,
            ],
            {
              titleEn: "⚠️ Lesson was not started",
              titleAr: "⚠️ الحصة لم تبدأ",

              bodyEn:
                "The lesson was not started during the scheduled time and has been sent for admin review.",

              bodyAr:
                "لم تبدأ الحصة خلال موعدها وتم تحويلها للمراجعة من الإدارة.",

              type: "lesson_problem",

              lessonId: lesson._id,
            }
          );

        } catch (err) {
          console.error(
            `[CRON] Error processing missed lesson ${lesson._id}:`,
            err
          );
        }
      }

    } catch (err) {
      console.error(
        "[CRON ERROR]",
        err
      );
    }
  });
};