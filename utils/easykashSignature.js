// utils/easykashSignature.js
const crypto = require("crypto");

exports.generateSignature = (payload) => {
  const secret = process.env.EASYKASH_SECRET;

  // ⚠️ الترتيب مهم جداً
  const dataString =
    payload.customerReference +
    payload.Amount +
    payload.status +
    payload.easykashRef;

  return crypto
    .createHmac("sha256", secret)
    .update(dataString)
    .digest("hex");
};

exports.verifySignature = (payload) => {
  const generated = exports.generateSignature(payload);

  return generated === payload.signatureHash;
};