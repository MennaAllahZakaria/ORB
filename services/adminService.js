const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");

const User = require("../models/userModel");
const sendEmail = require("../utils/sendEmail");
const ApiError = require("../utils/apiError");
const HandlerFactory = require("./handlerFactory");
const { generateStrongPassword } = require("../utils/generatePassword");

// Helper: get salt rounds from env (used for password hashing)
const getSaltRounds = () => parseInt(process.env.HASH_PASS, 10) || 12;

/**
 * ============================
 * ADMIN CREATION & MANAGEMENT
 * ============================
 */

/**
 * @desc    Create a new admin user
 * @route   POST /admin/admins
 * @access  Private (super admin)
 */
exports.createAdmin = asyncHandler(async (req, res, next) => {
  const { firstName, lastName, email, phone } = req.body;

  if (!firstName || !lastName || !email) {
    return next(
      new ApiError("firstName, lastName and email are required", 400)
    );
  }

  // Ensure email is not already registered
  const existing = await User.findOne({ email });
  if (existing) return next(new ApiError("Email already in use", 400));

  // Generate strong random password and hash it
  const password = generateStrongPassword();
  const hashedPassword = await bcrypt.hash(password, getSaltRounds());

  // Force role = "admin"
  const newAdmin = await User.create({
    firstName,
    lastName,
    email,
    phone,
    password: hashedPassword,
    role: "admin",
  });
  console.log("New admin created:", password);

  // Try to send credentials email (do NOT break if email fails)
  try {
    const message = `
                  Hi ${firstName} ${lastName},
                  Your admin account has been created.
                  Your temporary password is: ${password}
                  Please change your password after logging in.
                  `;
    await sendEmail({
      Email: email,
      subject: "Your Admin Account Details",
      message,
    });
  } catch (err) {
    console.error("Error sending email to new admin:", err.message);
  }

  res.status(201).json({
    status: "success",
    data: newAdmin,
  });
});

/**
 * @desc    Get all admins
 * @route   GET /admin/admins
 * @access  Private (admin)
 */
exports.getAllAdmins = asyncHandler(async (req, res, next) => {
  const admins = await User.find({ role: "admin" }).select(
    "firstName lastName email phone createdAt imageProfile"
  );

  res.status(200).json({
    status: "success",
    results: admins.length,
    data: admins,
  });
});

/**
 * @desc    Get a specific admin by id
 * @route   GET /admin/admins/:id
 * @access  Private (admin)
 */
exports.getAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const admin = await User.findOne({ _id: id, role: "admin" });
  if (!admin) {
    return next(new ApiError("Admin not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: admin,
  });
});

/**
 * @desc    Delete an admin
 * @route   DELETE /admin/admins/:id
 * @access  Private (admin)
 */
exports.deleteAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Prevent an admin from deleting themselves
  if (req.user._id.toString() === id) {
    return next(
      new ApiError("You cannot delete your own admin account", 400)
    );
  }

  const admin = await User.findOne({ _id: id, role: "admin" });
  if (!admin) {
    return next(new ApiError("Admin not found", 404));
  }

  await User.deleteOne({ _id: id });

  res.status(200).json({
    status: "success",
    message: "Admin deleted successfully",
  });
});

/**
 * @desc    Update admin basic info (NOT password/role)
 * @route   PATCH /admin/admins/:id
 * @access  Private (admin)
 */
exports.updateAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // Prevent role change away from "admin"
  if (updates.role && updates.role !== "admin") {
    return next(new ApiError("Cannot change role of an admin", 400));
  }

  // Prevent password change via this endpoint
  if (Object.prototype.hasOwnProperty.call(updates, "password")) {
    return next(
      new ApiError(
        "Cannot change password here. Use the dedicated password endpoint.",
        400
      )
    );
  }

  const admin = await User.findOneAndUpdate(
    { _id: id, role: "admin" },
    updates,
    { new: true }
  );

  if (!admin) {
    return next(new ApiError("Admin not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: admin,
  });
});

/**
 * ======================
 * GENERIC USER MANAGEMENT
 * ======================
 *
 * NOTE: These are generic handlers. Make sure the routes using them are
 * protected with admin-only authorization.
 */

// Get any user by id (admin usage only)
exports.getUser = HandlerFactory.getOne(User);

// Delete any user by id (admin usage only)
exports.deleteUser = HandlerFactory.deleteOne(User);

/**
 * @desc    Update user status (active/inactive/banned)
 * @route   PATCH /admin/users/:id/status
 * @access  Private (admin)
 */
exports.updateStatusUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["active", "inactive", "banned"].includes(status)) {
    return next(new ApiError("Invalid status value", 400));
  }

  const user = await User.findByIdAndUpdate(
    id,
    { status },
    { new: true }
  );

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: user,
  });
});

/**
 * ========================
 * TEACHER MANAGEMENT (ADMIN)
 * ========================
 */

/**
 * @desc    Get all teachers
 * @route   GET /admin/teachers
 * @access  Private (admin)
 */
exports.getAllTeachers = asyncHandler(async (req, res, next) => {
  const teachers = await User.find({ role: "teacher" }).select(
    "firstName lastName email phone teacherProfile imageProfile"
  );

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers,
  });
});

/**
 * @desc    Get teacher by id
 * @route   GET /admin/teachers/:id
 * @access  Private (admin)
 */
exports.getTeacher = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const teacher = await User.findOne({ _id: id, role: "teacher" });
  if (!teacher) {
    return next(new ApiError("Teacher not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: teacher,
  });
});

/**
 * @desc    Delete teacher by id
 * @route   DELETE /admin/teachers/:id
 * @access  Private (admin)
 */
exports.deleteTeacher = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const teacher = await User.findOne({ _id: id, role: "teacher" });
  if (!teacher) {
    return next(new ApiError("Teacher not found", 404));
  }

  await User.deleteOne({ _id: id });

  res.status(200).json({
    status: "success",
    message: "Teacher deleted successfully",
  });
});

/**
 * @desc    Get all teachers with pending verification
 * @route   GET /admin/teachers/pending
 * @access  Private (admin)
 */
exports.getAllPendingTeachers = asyncHandler(async (req, res, next) => {
  const teachers = await User.find({
    role: "teacher",
    "teacherProfile.verificationStatus": "pending",
  }).select("firstName lastName email phone teacherProfile");

  res.status(200).json({
    status: "success",
    results: teachers.length,
    data: teachers,
  });
});

/**
 * @desc    Approve teacher (verificationStatus -> approved)
 * @route   PATCH /admin/teachers/:id/verify
 * @access  Private (admin)
 */
exports.verifyTeacher = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const updates = { "teacherProfile.verificationStatus": "approved" };

  const teacher = await User.findOneAndUpdate(
    { _id: id, role: "teacher" },
    updates,
    { new: true }
  );

  if (!teacher) {
    return next(new ApiError("Teacher not found", 404));
  }

  // Notify teacher by email (do not break flow if email fails)
  try {
    const message = `
Hi ${teacher.firstName} ${teacher.lastName},
Congratulations! Your teacher account has been approved.
You can now login and start using your account.
`;
    await sendEmail({
      Email: teacher.email,
      subject: "Your Teacher Account Approved",
      message,
    });
  } catch (err) {
    console.error("Error sending teacher approval email:", err.message);
  }

  res.status(200).json({
    status: "success",
    data: teacher,
  });
});

/**
 * @desc    Reject teacher (verificationStatus -> rejected)
 * @route   PATCH /admin/teachers/:id/reject
 * @access  Private (admin)
 */
exports.rejectTeacher = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const updates = { "teacherProfile.verificationStatus": "rejected" };

  const teacher = await User.findOneAndUpdate(
    { _id: id, role: "teacher" },
    updates,
    { new: true }
  );

  if (!teacher) {
    return next(new ApiError("Teacher not found", 404));
  }

  // Notify teacher by email (do not break flow if email fails)
  try {
    const message = `
                    Hi ${teacher.firstName} ${teacher.lastName},
                    We regret to inform you that your teacher account has been rejected.
                    Reason: ${reason || "Not specified"}.
                    For more information, please contact support.
                    `;
    await sendEmail({
      Email: teacher.email,
      subject: "Your Teacher Account Rejected",
      message,
    });
  } catch (err) {
    console.error("Error sending teacher rejection email:", err.message);
  }

  res.status(200).json({
    status: "success",
    data: teacher,
  });
});

/**
 * ==========================
 * STUDENT MANAGEMENT (ADMIN)
 * ==========================
 */

/**
 * @desc    Get all students
 * @route   GET /admin/students
 * @access  Private (admin)
 */
exports.getAllStudents = asyncHandler(async (req, res, next) => {
  const students = await User.find({ role: "student" }).select(
    "firstName lastName email phone studentProfile imageProfile"
  );

  res.status(200).json({
    status: "success",
    results: students.length,
    data: students,
  });
});

/**
 * @desc    Get student by id
 * @route   GET /admin/students/:id
 * @access  Private (admin)
 */
exports.getStudent = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const student = await User.findOne({ _id: id, role: "student" });
  if (!student) {
    return next(new ApiError("Student not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: student,
  });
});

/**
 * @desc    Delete student by id
 * @route   DELETE /admin/students/:id
 * @access  Private (admin)
 */
exports.deleteStudent = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const student = await User.findOne({ _id: id, role: "student" });
  if (!student) {
    return next(new ApiError("Student not found", 404));
  }
  const message = `Dear ${student.firstName} ${student.lastName},
  
  We regret to inform you that your student account has been deleted by the administration.
  If you believe this is a mistake or have any questions, please contact our support team.
  `;
  // Notify student by email (do not break flow if email fails)
  try {
    await sendEmail({
      Email: student.email,
      subject: "Your Student Account Deleted",
      message,
    });
  } catch (err) {
    console.error("Error sending student deletion email:", err.message);
  } 

  await User.deleteOne({ _id: id });

  res.status(200).json({
    status: "success",
    message: "Student deleted successfully",
  });
});
