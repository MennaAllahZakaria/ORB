const express = require("express");

const {
    updatePaymentInfo,
    getPaymentInfo,
    getTeacherPayoutHistory,
    getAllTeachers,
    getTeacher,
    //updateAvailableTimes
} = require("../services/teacherService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const { updatePaymentInfoValidator } = require("../utils/validators/teacherValidator");
const router = express.Router();

router.use(protect);

// ================= TEACHER - UPDATE PAYMENT INFO =================
router.put(
    "/payment-info", allowedTo("teacher"),
    updatePaymentInfoValidator,
    updatePaymentInfo
);

// ================= TEACHER - GET PAYMENT INFO =================
router.get(
    "/payment-info", allowedTo("teacher"),
    getPaymentInfo
);
// ================= TEACHER - GET PAYOUT HISTORY =================
router.get(
    "/payout-history", allowedTo("teacher"),
    getTeacherPayoutHistory
);
// ================= TEACHER - GET PROFILE =================
router.get(
    "/:id/profile",
    getTeacher
);
// ================= TEACHER - UPDATE AVAILABLE TIMES =================
// router.put(
//     "/available-times", allowedTo("teacher"),
//     updateAvailableTimes
// );
// ================= GET ALL TEACHERS (Search + Filter + Pagination) =================
router.get("/", getAllTeachers);


module.exports = router;