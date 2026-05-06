const Payment = require("../../models/payment/paymentModel");
const Lesson = require("../../models/lessonModel");
const axios = require("axios");
const ApiError = require("../../utils/apiError");

exports.createPayment = async (req, res) => {
  try{
  const { lessonId } = req.body;
  const { SUCCESS_REDIRECT_URL } = req.body;

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return res.status(404).json({ message: "Lesson not found" });
  }
  if (lesson.status !== "approved") {
    return next(new ApiError("Lesson not ready for payment", 400));
  }

  if (lesson.paymentStatus === "paid") {
    return next(new ApiError("Already paid", 400));
  }


  const customerReference = new Date().getTime().toString();
  const totalAmount = Number(lesson.price).toFixed(2);
  const response = await axios.post(
    "https://back.easykash.net/api/directpayv1/pay",
    {
      amount: totalAmount,
      currency: "EGP",
      paymentOptions: [2, 4, 5, 6, 17, 31], // 2: Credit/Debit Card, 4: Mobile Wallet, 5: Fawry, 6: Meeza, 17: ValU, 31: Apple Pay
      redirectUrl: SUCCESS_REDIRECT_URL || "https://google.com",
      customerReference: customerReference,
      name: req.user.firstName + " " + req.user.lastName,
      email: req.user.email,
      mobile: req.user.phone ? req.user.phone.replace(/\+/g, '') : "01234567890",
    },
    {
      headers: {
        authorization: process.env.EASYKASH_API_KEY, 
      },
    }
  );
  const payment = await Payment.create({
    userId: req.user._id,
    lessonId,
    amount: totalAmount,
    customerReference: customerReference,
  });

 console.log("SUCCESS:", response.data);

  res.status(200).json({
    message: "Payment created successfully",
    data: {
      redirectUrl: response.data.redirectUrl,
      paymentId: payment._id,
    },
    });
  } catch (err) {
    console.log("ERROR DATA:", err.response?.data);
    console.log("ERROR STATUS:", err.response?.status);
    return next(new ApiError(err.response?.data?.message || err.message, err.response?.status || 500));
  }
};

exports.getPaymentById = async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate("userId", "firstName lastName email phone").populate("lessonId", "title price acceptedTeacher");
  if (!payment) {
    return new ApiError(404, "Payment not found");
  }

  if (req.user.role === "student" &&payment.userId._id.toString() !== req.user._id.toString() ) {  
      return new ApiError(403, "You don't have access to this payment");
  }
  if (req.user.role === "teacher" && payment.lessonId.acceptedTeacher.toString() !== req.user._id.toString()) {
    return new ApiError(403, "You don't have access to this payment");
  }
  

  res.status(200).json({
    message: "Payment retrieved successfully",
    data: payment,
  });
};

exports.getMyPayments = async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role;

  /* ===============================
     QUERY PARAMS
  =============================== */

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const skip = (page - 1) * limit;

  const { status, minAmount, maxAmount, fromDate, toDate } = req.query;

  /* ===============================
     BUILD FILTER
  =============================== */

  let filter = {};

  // role-based filtering
  if (role === "student") {
    filter.userId = userId;
  }

  if (role === "teacher") {
    const lessons = await Lesson.find({
      acceptedTeacher: userId,
    }).select("_id");

    const lessonIds = lessons.map((l) => l._id);
    filter.lessonId = { $in: lessonIds };
  }

  // status filter
  if (status) {
    filter.status = status;
  }

  // amount filter
  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }

  // date filter
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) filter.createdAt.$lte = new Date(toDate);
  }

  /* ===============================
     QUERY DB
  =============================== */

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("lessonId", "title price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Payment.countDocuments(filter),
  ]);

  /* ===============================
     RESPONSE
  =============================== */

  res.status(200).json({
    message: "Payments retrieved successfully",
    data: payments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
};