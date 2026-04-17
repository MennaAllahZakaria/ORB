const Payment = require("../../models/payment/paymentModel");
const Lesson = require("../../models/lessonModel");
const axios = require("axios");
const ApiError = require("../../utils/apiError");

exports.createPayment = async (req, res) => {
  const { lessonId } = req.body;

  const lesson = await Lesson.findById(lessonId);

  if (!lesson) {
    return res.status(404).json({ message: "Lesson not found" });
  }
  if (lesson.status !== "approved") {
    throw new Error("Lesson not ready for payment");
  }

  if (lesson.paymentStatus === "paid") {
    throw new Error("Already paid");
  }

  const payment = await Payment.create({
    userId: req.user._id,
    lessonId,
    amount: lesson.price,
    customerReference: new Date().getTime().toString(),
  });

  const response = await axios.post(
    "https://back.easykash.net/api/directpayv1/pay",
    {
      amount: lesson.price,
      currency: "EGP",
      paymentOptions: [2, 4, 5],
      redirectUrl: `${process.env.FRONT_URL}/payment-result`,
      customerReference: payment.customerReference,
    },
    {
      headers: {
        authorization: process.env.EASYKASH_API_KEY,
      },
    }
  );

  res.status(200).json({
    message: "Payment created successfully",
    data: {
      redirectUrl: response.data.redirectUrl,
      paymentId: payment._id,
    },
  });
};

exports.getPaymentById = async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    return new ApiError(404, "Payment not found");
  }

  if (req.user.role !== "admin" && !payment.userId.equals(req.user._id) && !payment.teacherId?.equals(req.user._id)) {
    return new ApiError(403, "You don't have access to this payment");
  }
  

  res.status(200).json({
    message: "Payment retrieved successfully",
    data: payment,
  });
};
