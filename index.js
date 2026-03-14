process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const http = require("http");

dotenv.config({ path: "config.env" });

const morgan = require("morgan");
const cors = require("cors");
const compression = require("compression");
const cron = require("node-cron");

const mountRoutes = require("./routes/index");
const globalError = require("./middleware/errorMiddleware");
const dbConnection = require("./config/database");
const { initSocket } = require("./config/socket");

const { initializeCronJobs } = require("./corn/cornJobs");

const app = express();

/* DB */
dbConnection()

/* MIDDLEWARE */
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "uploads")));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

/* ROUTES */
mountRoutes(app);
app.use(globalError);

/* SERVER */
const server = http.createServer(app);
initSocket(server);

/* CRON JOBS */
initializeCronJobs();


const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log(`App running on port ${PORT}`);
});

/* PROMISE ERRORS */
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);

  if (process.env.NODE_ENV === "production") {
    server.close(() => process.exit(1));
  }
});
