const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

let io;

exports.initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
    }
  });

  /* =============================
     AUTH MIDDLEWARE
  ============================== */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("No token provided"));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET_KEY
      );

      const user = await User.findById(decoded.userId);

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.user = user;

      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  /* =============================
     CONNECTION
  ============================== */
  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // 🔹 user private room
    socket.join(`user_${socket.user._id}`);

    // 🔹 teacher subject rooms
    if (socket.user.role === "teacher") {
      const subjects = socket.user.teacherProfile?.subjects || [];
      subjects.forEach(sub => {
        socket.join(`subject_${sub}`);
      });
    }

    // 🔹 join specific lesson
    socket.on("joinLesson", (lessonId) => {
      socket.join(`lesson_${lessonId}`);
    });

    socket.on("leaveLesson", (lessonId) => {
      socket.leave(`lesson_${lessonId}`);
    });

    socket.on("joinThread", (threadId) => {
      if (!threadId) return;
      socket.join(threadId.toString());
    });

    socket.on("leaveThread", (threadId) => {
      if (!threadId) return;
      socket.leave(threadId.toString());
    });

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });


  });
};

exports.getIO = () => io;
