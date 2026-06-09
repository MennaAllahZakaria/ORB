const SibApiV3Sdk = require("sib-api-v3-sdk");

const client = SibApiV3Sdk.ApiClient.instance;

client.authentications["api-key"].apiKey =
  process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const sendEmail = async (options) => {
  await emailApi.sendTransacEmail({
    sender: {
      name: "ORB",
      email: "orb.company.edu@gmail.com",
    },
    to: [
      {
        email: options.Email,
      },
    ],
    subject: options.subject,
    textContent: options.message,
  });
};

module.exports = sendEmail;