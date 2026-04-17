const express = require("express");
const router = express.Router();

const { easykashWebhook } = require("../../services/payment/easykashWebhookService");

/* ===============================
   EASYKASH WEBHOOK
=============================== */
router.post("/easykash", easykashWebhook);

module.exports = router;