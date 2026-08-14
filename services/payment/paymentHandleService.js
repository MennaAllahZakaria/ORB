const Payment = require("../../models/payment/paymentModel");
const Lesson = require("../../models/lessonModel");
const Ledger = require("../../models/payment/ledgerModel");
const Dispute = require("../../models/payment/disputeModel");
const Payout = require("../../models/payment/payoutModel");
const User = require("../../models/userModel");
const mongoose = require("mongoose");
const { sendNotification } = require("../../utils/notificationHelper");

const axios = require("axios");

const verifyEasyKashPayment = async (customerReference) => {
  const response = await axios.post(
    "https://back.easykash.net/api/cash-api/inquire",
    {
      customerReference,
    },
    {
      headers: {
        authorization: process.env.EASYKASH_API_KEY,
      },
    }
  );

  return response.data;
};



exports.handlePaymentSuccess = async ({
  providerRefNum,
  customerReference,
  amount,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.findOne({ customerReference }).session(session);

    if (!payment) throw new Error("Payment not found");

    if (payment.status === "paid" || payment.isProcessed) {
      await session.commitTransaction();
      return payment;
    }

    const inquiry = await verifyEasyKashPayment(customerReference);
    const lesson = await Lesson.findById(payment.lessonId).session(session);
    if (!lesson) throw new Error("Lesson not found");

    if (inquiry.status !== "PAID") {
      // A checkout attempt is not a payment. Persist the neutral state
      // instead of throwing after the save (which would rollback to pending).
      lesson.paymentStatus = "unpaid";
      if (lesson.fundsStatus === "held") {
        lesson.fundsStatus = "holding";
      }
      await lesson.save({ session });
      payment.status = "failed";
      await payment.save({ session });
      return;
    }

    if (Number(inquiry.Amount) !== payment.amount) {
      throw new Error("Amount mismatch");
    }


    if (!lesson.acceptedTeacher) {
      throw new Error("No teacher assigned");
    }

    // prevent double ledger
    const existingLedger = await Ledger.findOne({
      paymentId: payment._id,
    }).session(session);

    if (existingLedger) {
      await session.commitTransaction();
      return payment;
    }

    // update payment
    payment.status = "paid";
    payment.providerRefNum = inquiry.easykashRef;
    payment.paidAt = new Date();
    payment.isProcessed = true;
    await payment.save({ session });

    // update lesson
    lesson.paymentStatus = "paid";
    lesson.status = "approved";
    await lesson.save({ session });

    const platformFee = Math.round(payment.amount * 0.2);
    const teacherAmount = payment.amount - platformFee;

    // teacher pending
    await Ledger.create(
      [{
        userId: lesson.acceptedTeacher,
        amount: teacherAmount,
        type: "credit",
        status: "pending",
        source: "lesson",
        lessonId: lesson._id,
        paymentId: payment._id,
      }],
      { session }
    );

    // Notify Teacher about payment received (pending)
    const teacher = await User.findById(lesson.acceptedTeacher).session(session);
    if (teacher) {
      setImmediate(() => {
        sendNotification({
          recipient: teacher,
          titleEn: "💰 Payment Received",
          titleAr: "💰 تم استلام دفعة",
          bodyEn: `A payment of ${teacherAmount} EGP for lesson "${lesson.title}" is now pending in your wallet.`,
          bodyAr: `هناك دفعة قدرها ${teacherAmount} جنيه للحصة "${lesson.title}" قيد الانتظار في محفظتك.`,
          data: { type: "payment_received", lessonId: lesson._id.toString() }
        });
      });
    }

    // platform
    // await Ledger.create(
    //   [{
    //     userId: process.env.PLATFORM_USER_ID,
    //     amount: platformFee,
    //     type: "credit",
    //     status: "confirmed",
    //     source: "lesson",
    //     lessonId: lesson._id,
    //     paymentId: payment._id,
    //   }],
    //   { session }
    // );

    await session.commitTransaction();
    return payment;

  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

exports.handleLessonCompletion = async (lessonId, options = {}) => {
  const {
    skipTeacherConfirmation = false,
  } = options;

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {

      /* =====================================================
         1. GET LESSON
      ===================================================== */

      const lesson = await Lesson.findById(lessonId)
        .session(session);

      if (!lesson) {
        throw new Error("Lesson not found");
      }


      /* =====================================================
         2. PAYMENT VALIDATION
      ===================================================== */

      if (lesson.paymentStatus === "refund_pending") {
        throw new Error("Refund is pending");
      }

      if (lesson.paymentStatus === "refunded") {
        throw new Error("Lesson already refunded");
      }

      /*
        If payment has already been released,
        nothing else should happen.
      */

      if (lesson.fundsStatus === "released") {
        return;
      }

      if (lesson.paymentStatus !== "paid") {
        throw new Error("Lesson payment is not completed");
      }


      /* =====================================================
         3. LESSON MUST BE COMPLETED
      ===================================================== */

      if (
        lesson.finalCompletionStatus !== "completed"
      ) {
        return;
      }


      /* =====================================================
         4. DO NOT RELEASE DISPUTED LESSONS
      ===================================================== */

      if (
        lesson.disputeFlag === true ||
        [
          "disputed",
          "under_admin_review",
        ].includes(lesson.reviewStatus)
      ) {
        return;
      }


      /* =====================================================
         5. SESSION VERIFICATION
      ===================================================== */

      if (!lesson.sessionVerified) {
        return;
      }


      /* =====================================================
         6. MINIMUM SESSION DURATION
      ===================================================== */

      if (
        !lesson.durationInMinutes ||
        lesson.durationInMinutes < 10
      ) {
        return;
      }


      /* =====================================================
         7. GET COMPLETION SUBMISSIONS
      ===================================================== */

      const submissions =
        await CompleteLesson.find({
          lesson: lesson._id,
        })
          .session(session)
          .sort({ createdAt: 1 });


      const studentSubmission =
        submissions.find(
          (submission) =>
            submission.role === "student"
        );

      const teacherSubmission =
        submissions.find(
          (submission) =>
            submission.role === "teacher"
        );


      /* =====================================================
         8. STUDENT CONFIRMATION
      ===================================================== */

      const studentConfirmed =
        studentSubmission?.completionStatus ===
        "completed";


      /* =====================================================
         9. TEACHER CONFIRMATION
      ===================================================== */

      const teacherConfirmed =
        teacherSubmission?.completionStatus ===
        "completed";


      /* =====================================================
         10. REQUIRED CONFIRMATIONS
      ===================================================== */

      if (!studentConfirmed) {
        return;
      }

      /*
        Normally both parties must confirm.

        skipTeacherConfirmation is only used when
        admin has explicitly resolved the lesson
        as completed.
      */

      if (
        !teacherConfirmed &&
        !skipTeacherConfirmation
      ) {
        return;
      }


      /* =====================================================
         11. UPDATE LEDGER
      ===================================================== */

      await Ledger.updateMany(
        {
          lessonId: lesson._id,
          paymentId: lesson.paymentId,
          status: "pending",
          source: "lesson",
        },
        {
          $set: {
            status: "confirmed",
          },
        },
        {
          session,
        }
      );


      /* =====================================================
         12. ATOMIC PAYMENT RELEASE PROTECTION
      ===================================================== */

      const updatedLesson =
        await Lesson.findOneAndUpdate(
          {
            _id: lesson._id,

            paymentStatus: "paid",

            fundsStatus: "holding",

            finalCompletionStatus:
              "completed",

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
              fundsStatus: "released",

              paymentStatus: "released",

              status: "completed",

              reviewStatus:
                "auto_resolved",
            },
          },
          {
            new: true,
            session,
          }
        );


      /*
        Another request / cron may have released
        the funds at the same time.
      */

      if (!updatedLesson) {
        return;
      }


      /* =====================================================
         13. RETURN
      ===================================================== */

      return;
    });


    /* =====================================================
       14. GET FINAL LESSON
    ===================================================== */

    const finalLesson =
      await Lesson.findById(lessonId);

    if (!finalLesson) {
      throw new Error("Lesson not found");
    }

    return {
      decision:
        finalLesson.fundsStatus === "released"
          ? "released"
          : "hold",

      lesson: finalLesson,
    };

  } finally {
    await session.endSession();
  }
};



exports.handleDisputeResolution = async ({
  disputeId,
  decision,
  refundAmount = 0,
  adminId,
}) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Dispute not found");

  if (dispute.status === "resolved") return dispute;

  const lesson = await Lesson.findById(dispute.lessonId);
  if (!lesson) throw new Error("Lesson not found");

  const platformFee = Math.round(lesson.price * 0.2);
  const net = lesson.price - platformFee;

  if (decision === "release") {
    await Ledger.updateMany(
      { lessonId: lesson._id, status: "pending" },
      { status: "confirmed" }
    );

    lesson.fundsStatus = "released";
    lesson.status = "approved";
  }

  else if (decision === "refund") {
    await Ledger.updateMany(
      { lessonId: lesson._id, status: "pending" },
      { status: "cancelled" }
    );

    await Ledger.create({
      userId: lesson.student,
      amount: lesson.price,
      type: "credit",
      status: "confirmed",
      source: "refund",
    });

    lesson.fundsStatus = "refunded";
    lesson.status = "refunded";
  }

  else if (decision === "partial") {
    if (refundAmount > net) throw new Error("Invalid refund");

    const teacherShare = net - refundAmount;

    await Ledger.updateMany(
      { lessonId: lesson._id, status: "pending" },
      { status: "cancelled" }
    );

    await Ledger.create([
      {
        userId: lesson.acceptedTeacher,
        amount: teacherShare,
        type: "credit",
        status: "confirmed",
        source: "lesson",
      },
      {
        userId: lesson.student,
        amount: refundAmount,
        type: "credit",
        status: "confirmed",
        source: "refund",
      },
    ]);

    lesson.fundsStatus = "released";
    lesson.status = "approved";
  }

  dispute.status = "resolved";
  dispute.resolution = { decision, amount: refundAmount, decidedBy: adminId };
  dispute.resolvedAt = new Date();

  await dispute.save();
  await lesson.save();

  return { success: true };
};


exports.handlePayout = async ({ teacherId, amount, method, details }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const balanceAgg = await Ledger.aggregate([
      { $match: { userId: teacherId, status: "confirmed" } },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $cond: [
                { $eq: ["$type", "credit"] },
                "$amount",
                { $multiply: ["$amount", -1] }
              ]
            }
          }
        }
      }
    ]);

    const balance = balanceAgg[0]?.balance || 0;

    if (amount > balance) throw new Error("Insufficient balance");

    const payout = await Payout.create([{
      teacherId,
      amount,
      method,
      details,
      status: "pending",
    }], { session });

    await Ledger.create([{
      userId: teacherId,
      amount,
      type: "debit",
      status: "pending",
      source: "withdraw",
      payoutId: payout[0]._id,
    }], { session });

    await session.commitTransaction();

    return payout[0];

  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

exports.handleRefund = async ({
  lessonId,
  reason = "Lesson cancelled",
  requestedBy,
  canceledBy = null,
  session = null,
}) => {

  let ownSession = false;

  /*
    If no session was provided,
    this function creates its own transaction.

    If a session was provided,
    it uses the caller's transaction.
  */

  if (!session) {
    session = await mongoose.startSession();
    await session.startTransaction();
    ownSession = true;
  }

  try {

    /* =====================================================
       1. GET LESSON
    ===================================================== */

    const lesson =
      await Lesson.findById(lessonId)
        .session(session);

    if (!lesson) {
      throw new Error(
        "Lesson not found"
      );
    }


    /* =====================================================
       2. GET PAYMENT
    ===================================================== */

    const payment =
      await Payment.findOne({
        lessonId: lesson._id,
      }).session(session);

    if (!payment) {
      throw new Error(
        "Payment not found"
      );
    }


    /* =====================================================
       3. PAYMENT VALIDATION
    ===================================================== */

    if (
      payment.status ===
      "refund_pending"
    ) {
      throw new Error(
        "Refund is already pending"
      );
    }

    if (
      payment.status ===
      "refunded"
    ) {
      throw new Error(
        "Payment has already been refunded"
      );
    }

    if (
      payment.status !==
      "paid"
    ) {
      throw new Error(
        "Payment is not eligible for refund"
      );
    }


    /* =====================================================
       4. REFUND VALIDATION
    ===================================================== */

    if (
      payment.refund &&
      payment.refund.status &&
      payment.refund.status !== "none"
    ) {
      throw new Error(
        "Refund already requested or processed"
      );
    }


    /* =====================================================
       5. FUNDS VALIDATION
    ===================================================== */

    if (
      lesson.fundsStatus ===
      "released"
    ) {
      throw new Error(
        "Funds have already been released to teacher"
      );
    }

    if (
      lesson.fundsStatus ===
      "refunded"
    ) {
      throw new Error(
        "Lesson has already been refunded"
      );
    }


    if (
      lesson.fundsStatus !==
      "holding"
    ) {
      throw new Error(
        `Lesson funds are not eligible for refund. Current status: ${lesson.fundsStatus}`
      );
    }


    /* =====================================================
       6. DETERMINE CANCELLATION SOURCE
    ===================================================== */

    let cancellationSource =
      canceledBy;

    if (!cancellationSource && requestedBy) {

      if (
        lesson.student &&
        requestedBy.toString() ===
          lesson.student.toString()
      ) {
        cancellationSource =
          "student";

      } else if (
        lesson.acceptedTeacher &&
        requestedBy.toString() ===
          lesson.acceptedTeacher.toString()
      ) {
        cancellationSource =
          "teacher";
      }
    }


    if (
      cancellationSource &&
      !["student", "teacher"].includes(
        cancellationSource
      )
    ) {
      throw new Error(
        "Invalid cancellation source"
      );
    }


    /* =====================================================
       7. CANCEL PENDING LEDGER
    ===================================================== */

    await Ledger.updateMany(
      {
        paymentId:
          payment._id,

        status:
          "pending",
      },
      {
        $set: {
          status:
            "cancelled",
        },
      },
      {
        session,
      }
    );


    /* =====================================================
       8. ATOMIC PAYMENT UPDATE
    ===================================================== */

    const updatedPayment =
      await Payment.findOneAndUpdate(
        {
          _id:
            payment._id,

          status:
            "paid",

          $or: [
            {
              "refund.status": {
                $exists: false,
              },
            },
            {
              "refund.status":
                "none",
            },
          ],
        },
        {
          $set: {

            status:
              "refund_pending",

            refund: {

              status:
                "pending",

              requestedAt:
                new Date(),

              amount:
                payment.amount,

              note:
                reason,

              processedBy:
                requestedBy || null,
            },
          },
        },
        {
          new: true,
          session,
        }
      );


    if (!updatedPayment) {
      throw new Error(
        "Refund has already been requested or payment is no longer eligible"
      );
    }


    /* =====================================================
       9. UPDATE LESSON
    ===================================================== */

    lesson.paymentStatus =
      "refund_pending";

    lesson.fundsStatus =
      "refund_pending";


    /*
      Normal cancellation:
      student / teacher

      Admin dispute resolution:
      no canceledBy
      and lesson remains problem.
    */

    if (cancellationSource) {

      lesson.canceledBy =
        cancellationSource;

      lesson.status =
        "canceled";

    } else {

      /*
        Admin resolved the lesson
        as incomplete.

        It is a problem resolution,
        not a normal cancellation.
      */

      lesson.status =
        "problem";
    }


    await lesson.save({
      session,
    });


    /* =====================================================
       10. COMMIT ONLY IF THIS FUNCTION OWNS TRANSACTION
    ===================================================== */

    if (ownSession) {
      await session.commitTransaction();
    }


    /* =====================================================
       11. RETURN
    ===================================================== */

    return {
      success: true,

      payment:
        updatedPayment,

      lesson,

      refundStatus:
        "pending",
    };


  } catch (err) {

    if (ownSession) {
      await session.abortTransaction();
    }

    throw err;

  } finally {

    if (ownSession) {
      await session.endSession();
    }
  }
};