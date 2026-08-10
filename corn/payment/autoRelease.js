const Lesson = require("../../models/lessonModel");
const {
  handleLessonCompletion,
} = require("../../services/payment/paymentHandleService");

module.exports = async () => {
  try {

    /* =====================================================
       FIND ELIGIBLE LESSONS
    ===================================================== */

    const lessons = await Lesson.find({
      /*
        Payment must still be held.
      */
      paymentStatus: "paid",

      /*
        IMPORTANT:
        Your Lesson schema uses "holding", not "held".
      */
      fundsStatus: "holding",

      /*
        Student has not confirmed yet.
      */
      studentConfirmed: null,

      /*
        Lesson must already be completed normally.
      */
      finalCompletionStatus: "completed",

      /*
        Must not be a problem/dispute.
      */
      status: {
        $nin: [
          "problem",
          "canceled",
          "expired",
        ],
      },

      disputeFlag: false,

      reviewStatus: {
        $nin: [
          "disputed",
          "under_admin_review",
        ],
      },

      /*
        Give the student 24 hours before
        automatic confirmation.
      */
      updatedAt: {
        $lte: new Date(
          Date.now() - 24 * 60 * 60 * 1000
        ),
      },

    }).limit(20);


    /* =====================================================
       PROCESS
    ===================================================== */

    for (const lesson of lessons) {

      try {

        /*
          Atomic protection:
          Make sure the lesson is still eligible
          before modifying it.
        */

        const updatedLesson =
          await Lesson.findOneAndUpdate(
            {
              _id: lesson._id,

              paymentStatus: "paid",
              fundsStatus: "holding",

              studentConfirmed: null,

              finalCompletionStatus:
                "completed",

              status: {
                $nin: [
                  "problem",
                  "canceled",
                  "expired",
                ],
              },

              disputeFlag: false,

              reviewStatus: {
                $nin: [
                  "disputed",
                  "under_admin_review",
                ],
              },
            },
            {
              $set: {
                /*
                  Automatic confirmation after
                  24 hours.
                */
                studentConfirmed: true,
              },
            },
            {
              new: true,
            }
          );

        /*
          Another process may have changed the lesson.
        */

        if (!updatedLesson) {
          console.log(
            `[AUTO RELEASE] Skipping lesson ${lesson._id}, state changed`
          );

          continue;
        }


        /* =================================================
           RELEASE PAYMENT
        ================================================= */

        await handleLessonCompletion(
          updatedLesson._id
        );


        console.log(
          `[AUTO RELEASE] Payment released for lesson ${updatedLesson._id}`
        );

      } catch (err) {

        console.error(
          `[AUTO RELEASE] Lesson ${lesson._id}:`,
          err.message
        );

      }
    }

  } catch (err) {

    console.error(
      "[AUTO RELEASE ERROR]",
      err
    );

  }
};