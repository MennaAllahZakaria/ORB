const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/userModel");

test("user schema accepts superAdmin without requiring student or teacher profiles", () => {
  const user = new User({
    firstName: "System",
    lastName: "Owner",
    email: "owner@example.test",
    password: "secure-password",
    role: "superAdmin",
  });

  assert.equal(user.validateSync(), undefined);
  assert.equal(user.role, "superAdmin");
});

test("audit and dashboard modules load without changing existing route wiring", () => {
  assert.doesNotThrow(() => require("../services/auditService"));
  assert.doesNotThrow(() => require("../services/adminDashboardService"));
  assert.doesNotThrow(() => require("../routes/auditRoute"));
  assert.doesNotThrow(() => require("../routes/adminRoute"));
});
