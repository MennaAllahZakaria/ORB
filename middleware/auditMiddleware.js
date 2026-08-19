const { writeAuditLog } = require("../services/auditService");

exports.auditOnSuccess = ({ action, entityType }) => (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    const status = res.statusCode;
    if (status >= 200 && status < 300 && ["admin", "superAdmin"].includes(req.user?.role)) {
      const entityId = req.params.id || req.params.lessonId || payload?.data?._id || payload?.data?.dispute?._id;
      void writeAuditLog({
        req,
        action,
        entityType,
        entityId,
        after: payload?.data,
        metadata: { method: req.method, path: req.originalUrl },
      });
    }
    return originalJson(payload);
  };

  next();
};
