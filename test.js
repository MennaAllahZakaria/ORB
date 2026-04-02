const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  "338563705818-uqml6imkucvngg1i6v1dr413pvbj2pjo.apps.googleusercontent.com",
  "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",
  "https://developers.google.com/oauthplayground"
);

const code="4/0Aci98E95V-6kcAavLiDu_vIoeH1dBCVcELti27cAg4MZxnNfdmmBoIhHCMRs7dJEikW9Bw";

async function getToken() {
  const { tokens } = await oauth2Client.getToken(code);
  console.log(tokens);
}

getToken();