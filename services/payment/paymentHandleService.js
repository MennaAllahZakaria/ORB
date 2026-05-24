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

    if (payment.status === "paid") {
      await session.commitTransaction();
      return payment;
    }

    const inquiry = await verifyEasyKashPayment(customerReference);

    if (inquiry.status !== "PAID") {
      throw new Error("Payment not completed");
    }

    if (Number(inquiry.Amount) !== payment.amount) {
      throw new Error("Amount mismatch");
    }

    const lesson = await Lesson.findById(payment.lessonId).session(session);
    if (!lesson) throw new Error("Lesson not found");

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


exports.handleLessonCompletion = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId);

  if (!lesson) throw new Error("Lesson not found");

  if (lesson.paymentStatus !== "paid") throw new Error("Not paid");

  if (lesson.fundsStatus === "released") return lesson;

  // anti-fraud: minimum duration
  if (lesson.durationInMinutes < 10) {
    return { decision: "hold_short_session" };
  }

  const { sessionVerified, studentConfirmed, teacherConfirmed } = lesson;

  if (!sessionVerified) return { decision: "hold" };

  if (studentConfirmed === false) {
    const dispute = await Dispute.create({
      lessonId: lesson._id,
      studentId: lesson.student,
      teacherId: lesson.acceptedTeacher,
      reason: "quality",
      systemData: {
        sessionVerified,
        duration: lesson.durationInMinutes,
      },
    });

    lesson.status = "disputed";
    lesson.disputeId = dispute._id;
    await lesson.save();

    return { decision: "dispute" };
  }

  if (studentConfirmed && teacherConfirmed) {
    await Ledger.updateMany(
      { lessonId: lesson._id, status: "pending", source: "lesson" },
      { status: "confirmed" }
    );

    lesson.fundsStatus = "released";
    lesson.status = "approved";
    lesson.releasedAt = new Date();

    await lesson.save();

    return { decision: "released" };
  }

  return { decision: "hold" };
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