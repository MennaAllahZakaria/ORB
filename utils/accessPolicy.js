const ADMIN_COMPATIBLE_ROLES = new Set(["admin", "superAdmin"]);

exports.isAdminCompatibleRole = (role) => ADMIN_COMPATIBLE_ROLES.has(role);

exports.isRoleAllowed = (role, allowedRoles) => {
  if (allowedRoles.includes(role)) return true;
  return role === "superAdmin" && allowedRoles.includes("admin");
};

exports.canManageAdmins = (role) => role === "superAdmin";
