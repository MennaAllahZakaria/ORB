const asyncHandler = require("express-async-handler");
const AuditLog = require("../models/auditLogModel");

const SECRET_KEYS = new Set(["password", "passwordResetCode", "passwordResetExpires", "passwordResetVerified"]);

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const plain = typeof value.toObject === "function" ? value.toObject() : value;
    return Object.entries(plain).reduce((result, [key, nestedValue]) => {
      if (!SECRET_KEYS.has(key)) result[key] = sanitize(nestedValue);
      return result;
    }, {});
  }
  return value;
}

exports.writeAuditLog = async ({ req, actorId, actorRole, action, entityType, entityId, before, after, metadata }) => {
  try {
    const actor = req?.user;
    if (!(actorId || actor?._id) || !(actorRole || actor?.role)) return null;
    return await AuditLog.create({
      actorId: actorId || actor._id,
      actorRole: actorRole || actor.role,
      action,
      entityType,
      entityId,
      before: sanitize(before),
      after: sanitize(after),
      metadata: sanitize(metadata),
      requestId: req?.headers?.["x-request-id"],
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent"),
    });
  } catch (error) {
    // Logging is intentionally non-blocking: an audit-store incident must not break existing user flows.
    console.error("Audit log write failed:", error.message);
    return null;
  }
};

exports.listAuditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityType) filter.entityType = req.query.entityType;
  if (req.query.entityId) filter.entityId = req.query.entityId;
  if (req.query.actorId) filter.actorId = req.query.actorId;

  const [data, total] = await Promise.all([
    AuditLog.find(filter)
      .populate("actorId", "firstName lastName email role imageProfile")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);

  res.status(200).json({
    status: "success",
    results: data.length,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data,
  });
});
