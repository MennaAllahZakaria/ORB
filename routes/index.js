const authRoutes = require("./authRoute");
const adminRoutes = require("./adminRoute");
const lessonRoutes = require("./lessonRoute");
const completeLessonRoutes = require("./completeLessonRoute");
const negotiationRoutes = require("./negotiationRoutes");
const teacherRoutes = require("./teacherRoute");
const zegoRoutes = require("./zegoRoute");
const revieweRoutes = require("./reviewsRoute");
const pointsRoutes = require("./pointsRoute");
const supportRoutes = require("./supportRoute");
const notificationRoutes = require("./notificationRoute");
//payment
const payoutRoutes = require("./payment/payoutRoute");
const disputeRoutes = require("./payment/disputeRoute");
const webhookRoutes = require("./payment/webhookRoute");
const paymentRoutes = require("./payment/paymentRoute");


const mountRoutes = (app) => {
    app.use((req, res, next) => {
        const origin = req.headers.origin;

        if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
        }

        res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        );
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.header("Access-Control-Allow-Credentials", "true");

        if (req.method === "OPTIONS") {
        return res.sendStatus(200);
        }

        next();
    });

//=============================
// Mounting various routes
//=============================
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/lessons", lessonRoutes);
app.use("/completeLessons",completeLessonRoutes);
app.use("/negotiations", negotiationRoutes);
app.use("/teachers", teacherRoutes);
app.use("/zego", zegoRoutes);
app.use("/reviews", revieweRoutes);
app.use("/points", pointsRoutes);
app.use("/support", supportRoutes);
app.use("/notifications", notificationRoutes);
//payment
app.use("/payouts", payoutRoutes);
app.use("/disputes", disputeRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/payments", paymentRoutes);

//=============================
// 404 Handler
//=============================
app.use((req, res, next) => {
    res.status(404).json({
        status: 'fail',
        message: `Can't find this route: ${req.originalUrl}`,
    });
});

}

module.exports = mountRoutes;
