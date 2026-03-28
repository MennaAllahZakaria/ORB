const { generateToken04 } = require("./zegoServerAssistant");

exports.generateZegoToken = (userId, roomId) => {
  const appID = Number(process.env.ZEGO_APP_ID);
  const secret = process.env.ZEGO_SERVER_SECRET;

  const effectiveTimeInSeconds = 3600;

  const payloadObject = {
    room_id: roomId,
    privilege: {
      1: 1, // login room
      2: 1, // publish stream
    },
    stream_id_list: null,
  };

  const payload = JSON.stringify(payloadObject);

  const token = generateToken04(
    appID,
    userId,
    secret,
    effectiveTimeInSeconds,
    payload
  );

  return token;
};