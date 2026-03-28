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
const jwt = require("jsonwebtoken");

exports.generateZegoToken = (userId, roomId) => {
  const payload = {
    app_id: Number(process.env.ZEGO_APP_ID),
    user_id: userId,
    room_id: roomId,
  };

  return jwt.sign(payload, process.env.ZEGO_SERVER_SECRET, {
    expiresIn: "1h",
  });
}; 
