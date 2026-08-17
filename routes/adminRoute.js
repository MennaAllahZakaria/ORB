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
    deleteStudent,
    getLessonsWithIssues,
} = require("../services/adminService");
const { getDashboardSummary } = require("../services/adminDashboardService");

const { protect , allowedTo } = require("../middleware/authMiddleware");
const { auditOnSuccess } = require("../middleware/auditMiddleware");

const {
    createAdminValidator,
    idValidator,
    updateAdminValidator,
    updateUserStatusValidator,
} = require("../utils/validators/adminValidator");

const router = express.Router();

// ================= ADMIN =================

router.use(protect, allowedTo("admin", "superAdmin"));
// 📌 Create admin
router.post("/", allowedTo("superAdmin"), createAdminValidator, createAdmin);
// 📌 Get all admins
router.get("/", getAllAdmins);
// 📌 Get specific admin by id
router.get("/:id", idValidator, getAdmin);
// 📌 Delete admin
router.delete("/:id", allowedTo("superAdmin"), idValidator, auditOnSuccess({ action: "admin.deleted", entityType: "User" }), deleteAdmin);
// 📌 Update admin
router.put("/:id", allowedTo("superAdmin"), updateAdminValidator, auditOnSuccess({ action: "admin.updated", entityType: "User" }), updateAdmin);

// 📌 Summary dashboard (must remain before generic resource routes)
router.get("/dashboard/summary", getDashboardSummary);

//=======================User Management=========================
// 📌 Get  user
router.get("/users/:id", idValidator, getUser);
// 📌 Delete user
router.delete("/users/:id", idValidator, auditOnSuccess({ action: "user.deleted", entityType: "User" }), deleteUser);
// 📌 Update user status
router.patch("/users/:id/status", updateUserStatusValidator, auditOnSuccess({ action: "user.status_updated", entityType: "User" }), updateStatusUser);

//=======================Teacher Management=========================
// 📌 Get all teachers
router.get("/teachers/all", getAllTeachers);
// 📌 Get all pending teachers
router.get("/teachers/pending", getAllPendingTeachers);
// 📌 Get specific teacher by id
router.get("/teachers/:id", idValidator, getTeacher);
// 📌 Delete teacher
router.delete("/teachers/:id", idValidator, auditOnSuccess({ action: "teacher.deleted", entityType: "User" }), deleteTeacher);
// 📌 Verify teacher
router.put("/teachers/verify/:id", idValidator, auditOnSuccess({ action: "teacher.verified", entityType: "User" }), verifyTeacher);
// 📌 Reject teacher
router.put("/teachers/reject/:id", idValidator, auditOnSuccess({ action: "teacher.rejected", entityType: "User" }), rejectTeacher);

//=======================Student Management=========================
// 📌 Get all students
router.get("/students/all", getAllStudents);
// 📌 Get specific student by id
router.get("/students/:id", idValidator, getStudent);
// 📌 Delete student
router.delete("/students/:id", idValidator, auditOnSuccess({ action: "student.deleted", entityType: "User" }), deleteStudent);

//=======================Lessons with Issues=========================
// 📌 Get lessons with issues
router.get("/lessons/issues", getLessonsWithIssues);
module.exports = router;
