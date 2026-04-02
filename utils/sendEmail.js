const { google } = require("googleapis");

const sendEmail = async ({ Email, subject, message }) => {
  if (!Email || typeof Email !== "string") {
    throw new Error("Invalid email address");
  }

  if (!subject || !message) {
    throw new Error("Missing subject or message");
  }

  const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  oAuth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const rawMessage = Buffer.from(
    `From: ORB <${process.env.EMAIL_USER}>
To: ${Email}
Subject: ${subject}

${message}`
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: rawMessage,
    },
  });
};

module.exports = sendEmail;