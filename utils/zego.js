const { generateToken04 } = require("./zegoServerAssistant");

exports.generateZegoToken = (userId, roomId , effectiveTimeInSeconds = 7200) => {
  const appID = Number(process.env.ZEGO_APP_ID);
  const secret = process.env.ZEGO_SERVER_SECRET;


  const payloadObject = {
    room_id: roomId,
    user_id: userId,
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