const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Thread = require("../models/LessonNegotiationThreadModel");

let io;

exports.initSocket = (server) => {

  io = new Server(server, {
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ["websocket"],
    cors: {
      origin: "*",
    }
  });

  io.use(async (socket, next) => {
    try {

      const token = socket.handshake.auth?.token;

      if (!token)
        return next(new Error("No token provided"));

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET_KEY
      );

      const user = await User.findById(decoded.userId);

      if (!user)
        return next(new Error("User not found"));

      socket.user = user;

      next();

    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {

    console.log("Socket connected:", socket.id);

    socket.join(`user_${socket.user._id}`);

    if (socket.user.role === "teacher") {

      const subjects = socket.user.teacherProfile?.subjects || [];

      subjects.forEach(sub => {
        socket.join(`subject_${sub}`);
      });

    }

    socket.on("joinLesson", (lessonId) => {
      socket.join(`lesson_${lessonId}`);
    });

    socket.on("leaveLesson", (lessonId) => {
      socket.leave(`lesson_${lessonId}`);
    });

    socket.on("joinThread", async (threadId) => {

      if (!threadId) return;

      const thread = await Thread.findById(threadId);

      if (!thread) return;

      const isStudent = thread.student.equals(socket.user._id);
      const isTeacher = thread.teacher.equals(socket.user._id);

      if (!isStudent && !isTeacher) return;

      socket.join(threadId.toString());

    });

    socket.on("leaveThread", (threadId) => {
      socket.leave(threadId.toString());
    });

    socket.on("pingCheck", () => {
      socket.emit("pongCheck");
    });

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });

  });

};

exports.getIO = () => io;