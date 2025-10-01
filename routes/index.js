const authRoutes = require("./authRoute");
const adminRoutes = require("./adminRoute");
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
