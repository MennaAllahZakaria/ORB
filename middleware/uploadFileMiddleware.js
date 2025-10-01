const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");
const ApiError = require("../utils/apiError");

// Cloudinary Storage
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        let resourceType = "raw"; // default for PDF, txt, etc.
        if (file.mimetype.startsWith("image/")) resourceType = "image";

        return {
        folder: "uploads",
        resource_type: resourceType,
        public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
        };
    },
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        "application/pdf", // certificate PDF
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/jpg",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new ApiError("Only PDF or image files are allowed", 400), false);
    }

    cb(null, true);
};

// Multer upload
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

// Middleware: رفع ملفات متعددة
exports.uploadFiles = upload.fields([
    { name: "certificate", maxCount: 1 },
    { name: "imageProfile", maxCount: 1 },
]);
