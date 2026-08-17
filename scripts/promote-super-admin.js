require("dotenv").config({ path: "config.env" });

const mongoose = require("mongoose");
const User = require("../models/userModel");

async function promote() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("SUPER_ADMIN_EMAIL is required");

  if (!process.env.DB_URI) throw new Error("DB_URI is required");
  await mongoose.connect(process.env.DB_URI);
  const user = await User.findOneAndUpdate(
    { email, role: "admin" },
    { role: "superAdmin" },
    { new: true }
  );

  if (!user) throw new Error("No existing admin found for SUPER_ADMIN_EMAIL");
  console.log(`Promoted ${user.email} to superAdmin`);
  await mongoose.disconnect();
}

promote().catch((error) => {
  console.error(error.message);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
