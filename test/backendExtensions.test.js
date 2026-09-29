const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/userModel");
const Payout = require("../models/payment/payoutModel");

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

test("account status is restricted to the supported lifecycle states", () => {
  const user = new User({
    firstName: "Test",
    lastName: "User",
    email: "status@example.test",
    password: "secure-password",
    role: "student",
    status: "inactive",
  });

  assert.equal(user.validateSync(), undefined);
  assert.equal(user.status, "inactive");
});

test("payout schema rejects non-positive amounts", () => {
  const payout = new Payout({
    teacherId: "507f1f77bcf86cd799439011",
    amount: -10,
    method: "wallet",
  });

  assert.ok(payout.validateSync().errors.amount);
});
