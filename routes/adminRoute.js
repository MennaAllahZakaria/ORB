const express = require("express");
const {
    createAdmin,
    getAllAdmins,
    getAdmin,
    deleteAdmin,
    updateAdmin,
    getUser,
    deleteUser,
    updateStatusUser,
    getAllTeachers,
    getTeacher,
    deleteTeacher,
    getAllPendingTeachers,
    verifyTeacher,
    rejectTeacher,
    getAllStudents,
    getStudent,
    deleteStudent
} = require("../services/adminService");

const { protect , allowedTo } = require("../middleware/authMiddleware");

const {
    createAdminValidator,
    idValidator,
    updateAdminValidator,
    updateUserStatusValidator,
} = require("../utils/validators/adminValidator");

const router = express.Router();

// ================= ADMIN =================

router.use(protect, allowedTo("admin"));
// 📌 Create admin
router.post("/", createAdminValidator, createAdmin);
// 📌 Get all admins
router.get("/", getAllAdmins);
// 📌 Get specific admin by id
router.get("/:id", idValidator, getAdmin);
// 📌 Delete admin
router.delete("/:id", idValidator, deleteAdmin);
// 📌 Update admin
router.put("/:id", updateAdminValidator, updateAdmin);

//=======================User Management=========================
// 📌 Get  user
router.get("/users/:id", idValidator, getUser);
// 📌 Delete user
router.delete("/users/:id", idValidator, deleteUser);
// 📌 Update user status
router.patch("/users/:id/status", updateUserStatusValidator, updateStatusUser);

//=======================Teacher Management=========================
// 📌 Get all teachers
router.get("/teachers/all", getAllTeachers);
// 📌 Get all pending teachers
router.get("/teachers/pending", getAllPendingTeachers);
// 📌 Get specific teacher by id
router.get("/teachers/:id", idValidator, getTeacher);
// 📌 Delete teacher
router.delete("/teachers/:id", idValidator, deleteTeacher);
// 📌 Verify teacher
router.put("/teachers/verify/:id", idValidator, verifyTeacher);
// 📌 Reject teacher
router.put("/teachers/reject/:id", idValidator, rejectTeacher);

//=======================Student Management=========================
// 📌 Get all students
router.get("/students/all", getAllStudents);
// 📌 Get specific student by id
router.get("/students/:id", idValidator, getStudent);
// 📌 Delete student
router.delete("/students/:id", idValidator, deleteStudent);
module.exports = router;