// utils/easykashSignature.js
const crypto = require("crypto");

exports.generateSignature = (payload) => {
  const secret = process.env.EASYKASH_SECRET;

  // ⚠️ الترتيب والحقول مهمة جداً حسب التوثيق الرسمي لـ EasyKash
  // https://easykash.gitbook.io/easykash-apis-documentation/direct-payment-hosted/callback-service/callback-response-verification
  const dataToSecure = [
    payload.ProductCode,
    payload.Amount,
    payload.ProductType,
    payload.PaymentMethod,
    payload.status,
    payload.easykashRef,
    payload.customerReference,
  ];
  
  const dataStr = dataToSecure.join('');

  return crypto
    .createHmac("sha512", secret)
    .update(dataStr)
    .digest("hex");
};

exports.verifySignature = (payload) => {
  const generated = exports.generateSignature(payload);

  return generated === payload.signatureHash;
};