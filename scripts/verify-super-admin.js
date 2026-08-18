const mongoose = require("mongoose");
const User = require("../models/userModel");

async function verify() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!process.env.DB_URI) throw new Error("DB_URI is required");
  if (!email) throw new Error("SUPER_ADMIN_EMAIL is required");

  await mongoose.connect(process.env.DB_URI);
  const user = await User.findOne({ email }).select("email role");
  await mongoose.disconnect();

  if (!user) throw new Error("Admin account was not found");
  if (user.role !== "superAdmin") throw new Error("Account role is not superAdmin");
  console.log("Verified superAdmin role");
}

verify().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
