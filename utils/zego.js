const crypto = require("crypto");

/**
 * Generate Zego Token
 * @param {number} appId
 * @param {string} serverSecret
 * @param {string} userId
 * @param {string} roomId
 * @param {number} effectiveTimeInSeconds
 * @returns {string}
 */
exports.generateZegoToken = ( userId, roomId, effectiveTimeInSeconds = 3600) => {
  const payload = {
    app_id: process.env.ZEGO_APP_ID,
    user_id: userId,
    ctime: Math.floor(Date.now() / 1000),
    expire: effectiveTimeInSeconds,
    nonce: Math.floor(Math.random() * 999999),
    room_id: roomId,
  };

  const text = JSON.stringify(payload);
  const cipher = crypto.createHmac("sha256", process.env.ZEGO_SERVER_SECRET).update(text).digest("hex");
  const token = Buffer.from(`${text}.${cipher}`).toString("base64");
  return token;
};
