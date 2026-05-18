const express = require("express");

const {
    updatePaymentInfo,
    getPaymentInfo,
    getTeacherPayoutHistory,
    getTeacherBalance,
    getAllTeachers,
    getTeacher,
    //updateAvailableTimes
} = require("../services/teacherService");

const { protect, allowedTo } = require("../middleware/authMiddleware");

const { updatePaymentInfoValidator } = require("../utils/validators/teacherValidator");
const router = express.Router();

router.use(protect);

// ================= TEACHER - UPDATE PAYMENT INFO =================
router.patch(
    "/me/payment-info", allowedTo("teacher"),
    updatePaymentInfoValidator,
    updatePaymentInfo
);

// ================= TEACHER - GET PAYMENT INFO =================
router.get(
    "/me/payment-info", allowedTo("teacher"),
    getPaymentInfo
);
// ================= TEACHER - GET PAYOUT HISTORY =================
router.get(
    "/me/payout-history", allowedTo("teacher"),
    getTeacherPayoutHistory
);
// ================= TEACHER - GET BALANCE =================
router.get(
    "/me/balance", allowedTo("teacher"),
    getTeacherBalance
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