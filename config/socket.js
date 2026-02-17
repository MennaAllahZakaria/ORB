const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

let io;

exports.initSocket = (server) => {
  io = new Server(server, {
    cors: { origin: "*" }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.id);

      socket.user = user;

      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("connected:", socket.user._id);

    socket.on("joinThread", (threadId) => {
      socket.join(threadId);
    });

    socket.on("leaveThread", (threadId) => {
      socket.leave(threadId);
    });
  });
};

exports.getIO = () => io;
