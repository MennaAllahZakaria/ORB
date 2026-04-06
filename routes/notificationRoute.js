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

const router = express.Router();

router.post('/',protect,allowedTo("admin"),addNotification);

router
  .route("/all")
  .get(protect, getNotifications)
  .delete(protect, deleteAllNotifications);

router
  .route("/:id")
  .get(protect, getNotificationById)
  .delete(protect, deleteNotification);

router.put("/read/:id", protect, markNotificationAsRead);

module.exports = router;