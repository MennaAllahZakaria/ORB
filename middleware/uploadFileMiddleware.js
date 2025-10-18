const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");
const ApiError = require("../utils/apiError");

// إعدادات تخزين عامة على Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "uploads";
    let resource_type = "raw";

    if (file.fieldname === "imageProfile") {
      folder = "profile_images";
      resource_type = "image";
    } else if (file.fieldname === "certificate") {
      folder = "certificates";
      resource_type = "raw";
    }

    return {
      folder,
      resource_type,
      public_id: `${Date.now()}-${file.originalname.split(".")[0].trim().replace(/\s+/g, "_")}`,
      format: file.mimetype.split("/")[1],
    };
  },
});

// الفلتر للتأكد من نوع الملفات المقبولة
const fileFilter = (req, file, cb) => {
  if (
    file.fieldname === "imageProfile" &&
    !file.mimetype.startsWith("image/")
  ) {
    return cb(new ApiError("Only images allowed for imageProfile", 400), false);
  }

  if (
    file.fieldname === "certificate" &&
    file.mimetype !== "application/pdf"
  ) {
    return cb(new ApiError("Only PDF allowed for certificate", 400), false);
  }

  cb(null, true);
};

// إعداد multer
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ميدل وير لرفع صورة وملف معًا
exports.uploadImageAndFile = upload.fields([
  { name: "imageProfile", maxCount: 1 },
  { name: "certificate", maxCount: 1 },
]);

// ميدل وير لإضافة اللينكات في req
exports.attachUploadedLinks = (req, res, next) => {
  try {
    if (req.files?.imageProfile?.[0]) {
      req.imageProfileUrl = req.files.imageProfile[0].path;
    }
    if (req.files?.certificate?.[0]) {
      req.certificateUrl = req.files.certificate[0].path;
    }


    next();
  } catch (err) {
    next(new ApiError("Error processing uploaded files", 500));
  }
};
