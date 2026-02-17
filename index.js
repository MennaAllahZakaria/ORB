const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const http = require("http"); 

const ApiError = require("./utils/apiError");

dotenv.config({ path: "config.env" });

const morgan = require("morgan");
const cors = require("cors");
const compression = require("compression");

const mountRoutes = require("./routes/index");
const globalError = require("./middleware/errorMiddleware");
const dbConnection = require("./config/database");

const { initSocket } = require("./config/socket"); // 👈 الجديد

/* =========================
   DB
========================= */
dbConnection();

/* =========================
   EXPRESS
========================= */
const app = express();

app.use(cors());
app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "uploads")));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
  console.log(process.env.NODE_ENV);
}

/* =========================
   ROUTES
========================= */
mountRoutes(app);

/* =========================
   GLOBAL ERROR
========================= */
app.use(globalError);

/* =========================
   HTTP SERVER (IMPORTANT)
========================= */
const server = http.createServer(app); // 👈 بدل app.listen

/* =========================
   SOCKET INIT
========================= */
initSocket(server); // 👈 ربط socket بالسيرفر

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log(`App running on port ${PORT}`);
});

/* =========================
   HANDLE PROMISE REJECTION
========================= */
process.on("unhandledRejection", (err) => {
  console.error(`unhandledRejection: ${err.name} | ${err.message}`);

  server.close(() => {
    console.error(`Shutting down...`);
    process.exit(1);
  });
});
