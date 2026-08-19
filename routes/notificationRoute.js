const express = require("express");

const {
  getNotifications,
  getNotificationById,
  markNotificationAsRead,
  deleteNotification,
  deleteAllNotifications,
  addNotification
} = require("../services/notificationService");

const { protect, allowedTo } = require("../middleware/authMiddleware");
const { auditOnSuccess } = require("../middleware/auditMiddleware");

const router = express.Router();

router.post('/',protect,allowedTo("admin"),auditOnSuccess({ action: "notification.sent", entityType: "Notification" }),addNotification);

router
  .route("/all")
  .get(protect, getNotifications)
  .delete(protect, deleteAllNotifications);

router
  .route("/:id")
  .get(protect, getNotificationById)
  .delete(protect, auditOnSuccess({ action: "notification.deleted", entityType: "Notification" }), deleteNotification);

router.put("/read/:id", protect, auditOnSuccess({ action: "notification.read", entityType: "Notification" }), markNotificationAsRead);

module.exports = router;
