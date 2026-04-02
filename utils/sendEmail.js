const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

  const mailOpts = {
    from: "ORB <orb.company.edu@gmail.com>",
    to: options.Email,
    subject: options.subject,
    text: options.message,
  };

  //  non-blocking
  transporter.sendMail(mailOpts).catch((err) => {
    console.error("Email Error:", err);
  });
};

module.exports = sendEmail;
