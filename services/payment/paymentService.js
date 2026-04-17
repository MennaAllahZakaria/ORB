const Payment = require("../../models/payment/paymentModel");
const Lesson = require("../../models/lessonModel");
const axios = require("axios");
const ApiError = require("../../utils/apiError");

exports.createPayment = async (req, res) => {
  try{
  const { lessonId } = req.body;
  const { FRONT_URL } = req.body;

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


  const response = await axios.post(
    "https://back.easykash.net/api/directpayv1/pay",
    {
      amount: Number(lesson.price).toFixed(2),
      currency: "EGP",
      paymentOptions: [2], 
      redirectUrl: "https://google.com", // test 
      customerReference: new Date().getTime().toString(),
      name: req.user.firstName + " " + req.user.lastName,
      email: req.user.email,
      mobile: req.user.phone,
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
    amount: lesson.price,
    customerReference: response.data.customerReference,
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
    throw err;
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
