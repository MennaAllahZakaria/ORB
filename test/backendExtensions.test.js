const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/userModel");
const Payout = require("../models/payment/payoutModel");
const AccountReactivationRequest = require("../models/accountReactivationRequestModel");

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

test("reactivation request schema requires a supported account status and reason", () => {
  const request = new AccountReactivationRequest({
    user: "507f1f77bcf86cd799439011",
    email: "inactive@example.test",
    reason: "I would like to use my account again.",
    requestedStatus: "inactive",
  });

  assert.equal(request.validateSync(), undefined);
  assert.equal(request.status, "pending");

  const invalid = new AccountReactivationRequest({
    user: "507f1f77bcf86cd799439011",
    email: "inactive@example.test",
    reason: "short",
    requestedStatus: "active",
  });
  assert.ok(invalid.validateSync().errors.requestedStatus);
});
