const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oAuth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const sendEmail = async (options) => {
  console.log("STEP 1");
  const accessTokenResponse = await oAuth2Client.getAccessToken();
  console.log("STEP 2");

  const accessToken = accessTokenResponse?.token;
  console.log("TOKEN:", accessToken);

  console.log("STEP 3");
  try {
    const accessTokenResponse = await Promise.race([
      oAuth2Client.getAccessToken(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Token timeout")), 10000)
      ),
    ]);

    const accessToken = accessTokenResponse?.token;

    if (!accessToken) {
      throw new Error("No access token");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: process.env.EMAIL_USER,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN,
        accessToken,
      },
    });

    await transporter.sendMail({
      from: `ORB <${process.env.EMAIL_USER}>`,
      to: options.Email,
      subject: options.subject,
      text: options.message,
    });

  } catch (err) {
    console.error("EMAIL ERROR FULL:", err);
    throw err;
  }
};

module.exports = sendEmail;