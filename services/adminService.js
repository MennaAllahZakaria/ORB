const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const sendEmail = require("../utils/sendEmail"); 
const ApiError = require("../utils/apiError");
const HandlerFactory = require("./handlerFactory");
const {generateStrongPassword} = require("../utils/generatePassword")

// ==================== ADMIN - CREATE NEW ADMIN ====================

exports.createAdmin = async (req, res, next) => {
    try {
        const { firstName, lastName, email, phone } = req.body;

        // check if email exists
        const existing = await User.findOne({ email });
        if (existing) return next(new ApiError("Email already in use", 400));

        // generate strong random password
        const password = generateStrongPassword();
        // hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        const newAdmin = await User.create({
        firstName,
        lastName,
        email,
        phone,
        password: hashedPassword,
        role: "admin", // force admin role
        });

        // send email to admin with their password
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

            return next(new ApiError("Error sending email to new admin", 500));
        }

        res.status(201).json({
        status: "success",
        data: newAdmin,
        });
    } catch (err) {
        next(err);
    }
};

// ==================== ADMIN - GET ALL ADMINS ====================
exports.getAllAdmins = asyncHandler(async (req, res, next) => {
    const admins = await User.find({ role: "admin" }).select(
        "firstName lastName email phone createdAt imageProfile "
    );  
    res.status(200).json({
        status: "success",
        results: admins.length,
        data: admins,
    });
});

// ==================== ADMIN - GET SPECIFIC ADMIN ====================
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

// ==================== ADMIN - DELETE ADMIN ====================
exports.deleteAdmin = asyncHandler(async (req, res, next) => {

    const { id } = req.params;

    // ✅ admin cannot delete themselves
    if (req.user._id.toString() === id) {
        return next(new ApiError("You cannot delete your own admin account", 400));
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

// ==================== ADMIN - UPDATE ADMIN ====================
exports.updateAdmin = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const updates = req.body;

    // Prevent role change
    if (updates.role && updates.role !== "admin") {
        return next(new ApiError("Cannot change role of an admin", 400));
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

//=======================User Management=========================

exports.getUser = HandlerFactory.getOne(User);
exports.deleteUser = HandlerFactory.deleteOne(User);
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


//=======================Teacher Management=========================

exports.getAllTeachers = asyncHandler(async (req, res, next) => {
    const teachers = await User.find({ role: "teacher" })
                               .select("firstName lastName email phone teacherProfile imageProfile");
    res.status(200).json({
        status: "success",
        results: teachers.length,
        data: teachers,
    });
});

exports.getTeacher = HandlerFactory.getOne(User);

exports.deleteTeacher = HandlerFactory.deleteOne(User);

exports.getAllPendingTeachers = asyncHandler(async (req, res, next) => {
    const teachers = await  User.find({ role: "teacher", "teacherProfile.status": "pending" })
                                .select("firstName lastName email phone teacherProfile");
    res.status(200).json({
        status: "success",
        results: teachers.length,
        data: teachers,
    });
});

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

    // Send email notification to teacher about approval
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
        return next(new ApiError("Error sending email to teacher", 500));
    }

    res.status(200).json({
        status: "success",
        data: teacher,
    });
});

exports.rejectTeacher = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const updates = { "teacherProfile.verificationStatus": "rejected" };

    const teacher = await User.findOneAndUpdate(
        { _id: id, role: "teacher" },
        updates,
        { new: true }
    );

    if (!teacher) {
        return next(new ApiError("Teacher not found", 404));
    }

    // Send email notification to teacher about rejection
    try {
        const message = `
        Hi ${teacher.firstName} ${teacher.lastName},
        We regret to inform you that your teacher account has been rejected.
        For more information, please contact support.
        `;

        await sendEmail({
        Email: teacher.email,
        subject: "Your Teacher Account Rejected",
        message,
        });


    } catch (err) {
        return next(new ApiError("Error sending email to teacher", 500));
    }


    res.status(200).json({
        status: "success",
        data: teacher,
    });
});

// ==================== ADMIN - STUDENT MANAGEMENT ====================
exports.getAllStudents = asyncHandler(async (req, res, next) => {
    const students = await User.find({ role: "student" })
                               .select("firstName lastName email phone studentProfile imageProfile");   
    res.status(200).json({
        status: "success",
        results: students.length,
        data: students,
    });
});
exports.getStudent = HandlerFactory.getOne(User);
exports.deleteStudent = HandlerFactory.deleteOne(User);
