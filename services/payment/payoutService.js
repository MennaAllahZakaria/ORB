const Payout = require("../../models/payment/payoutModel");
const Ledger = require("../../models/payment/ledgerModel");
const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const { handlePayout } = require("./paymentHandleService");
const { sendNotification } = require("../../utils/notificationHelper");
const { writeAuditLog } = require("../auditService");
const mongoose = require("mongoose");

exports.requestPayout = asyncHandler(async (req, res) => {
  const { amount, method, details } = req.body;



  const payout = await handlePayout({
    teacherId: req.user._id,
    amount,
    method,
    details,
  });

  res.status(200).json({
    message: "Payout request created successfully",
    data: payout,
  });

});

exports.completePayout = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let payout;

  try {
    payout = await Payout.findById(req.params.id).session(session);

    if (!payout) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Not found" });
    }
    if (payout.status === "completed") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Already completed" });
    }
    if (!["pending", "processing"].includes(payout.status)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Only pending or processing payouts can be completed" });
    }

    const before = { status: payout.status, amount: payout.amount, teacherId: payout.teacherId };
    payout.status = "completed";
    payout.processedAt = new Date();
    await payout.save({ session });

    const ledgerResult = await Ledger.updateMany(
      { payoutId: payout._id, status: "pending", type: "debit", source: "withdraw" },
      { status: "confirmed" },
      { session }
    );
    if (ledgerResult.modifiedCount !== 1) {
      throw new Error("Payout ledger entry is missing or already finalized");
    }

    await session.commitTransaction();

    await writeAuditLog({
      req,
      action: "payout.completed",
      entityType: "Payout",
      entityId: payout._id,
      before,
      after: { status: payout.status, processedAt: payout.processedAt, amount: payout.amount },
    });

    // Notify Teacher
    const teacher = await User.findById(payout.teacherId);
    if (teacher) {
      setImmediate(() => {
        sendNotification({
          recipient: teacher,
          titleEn: "💸 Payout Completed",
          titleAr: "💸 تم تحويل الرصيد",
          bodyEn: `Your payout request of ${payout.amount} EGP has been processed successfully.`,
          bodyAr: `تمت معالجة طلب سحب الرصيد الخاص بك بمبلغ ${payout.amount} جنيه بنجاح.`,
          data: { type: "payout_completed", payoutId: payout._id.toString() }
        });
      });
    }

    return res.status(200).json({
      message: "Payout marked as completed",
      data: payout,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

exports.getMyPayouts = asyncHandler(async (req, res) => {

  const teacherId = req.user._id;

  /* ===============================
     QUERY PARAMS
  =============================== */

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  const { status, method, fromDate, toDate } = req.query;

  /* ===============================
     FILTER
  =============================== */

  const filter = { teacherId };

  if (status) {
    filter.status = status; // pending / completed / failed
  }

  if (method) {
    filter.method = method; // wallet / bank
  }

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) filter.createdAt.$lte = new Date(toDate);
  }

  /* ===============================
     QUERY
  =============================== */

  const [payouts, total] = await Promise.all([
    Payout.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Payout.countDocuments(filter),
  ]);

  /* ===============================
     RESPONSE
  =============================== */

  res.status(200).json({
    message: "Payouts retrieved successfully",
    data: payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

exports.getAllPayouts = asyncHandler(async (req, res) => {

  /* ===============================
     QUERY PARAMS
  =============================== */

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  const { status, method, teacherId, minAmount, maxAmount } = req.query;

  /* ===============================
     FILTER
  =============================== */

  const filter = {};

  if (status) filter.status = status;

  if (method) filter.method = method;

  if (teacherId) filter.teacherId = teacherId;

  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }

  /* ===============================
     QUERY
  =============================== */

  const [payouts, total] = await Promise.all([
    Payout.find(filter)
      .populate("teacherId", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Payout.countDocuments(filter),
  ]);

  /* ===============================
     RESPONSE
  =============================== */

  res.status(200).json({
    message: "Payouts retrieved successfully",
    data: payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});
