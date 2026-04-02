const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  "338563705818-uqml6imkucvngg1i6v1dr413pvbj2pjo.apps.googleusercontent.com",
  "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",
  "http://localhost:3000/oauth2callback"
);

const code="4/0Aci98E-eVH3wgIMbqyRWb6UN8xvgwQaWyRKfMZ8nWi6I9ReYzAJDDQWZ09ZfEscNUnuC2w&scope=https://mail.google.com/";

async function getToken() {
  const { tokens } = await oauth2Client.getToken(code);
  console.log(tokens);
}

getToken();