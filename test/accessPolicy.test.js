const test = require("node:test");
const assert = require("node:assert/strict");
const { isRoleAllowed, canManageAdmins, isAdminCompatibleRole } = require("../utils/accessPolicy");

test("superAdmin remains compatible with existing admin-only routes", () => {
  assert.equal(isRoleAllowed("superAdmin", ["admin"]), true);
  assert.equal(isRoleAllowed("admin", ["admin"]), true);
  assert.equal(isRoleAllowed("teacher", ["admin"]), false);
});

test("only superAdmin can manage admin accounts", () => {
  assert.equal(canManageAdmins("superAdmin"), true);
  assert.equal(canManageAdmins("admin"), false);
  assert.equal(canManageAdmins("student"), false);
});

test("both admin-compatible roles can operate legacy admin services", () => {
  assert.equal(isAdminCompatibleRole("admin"), true);
  assert.equal(isAdminCompatibleRole("superAdmin"), true);
  assert.equal(isAdminCompatibleRole("teacher"), false);
});
