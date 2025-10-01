const crypto = require("crypto");

// Encryption key (must be securely stored and consistent)
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error("Invalid ENCRYPTION_KEY length. Key must be 32 bytes.");
}
const IV_LENGTH = 16; // AES block size

exports.encryptToken = (token) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(token, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

exports.decryptToken = (encryptedToken) => {
  const parts = encryptedToken.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted token format");
  }

  const [iv, encrypted] = parts;

  if (Buffer.from(iv, "hex").length !== IV_LENGTH) {
    throw new Error("Invalid IV length. IV must be 16 bytes.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    ENCRYPTION_KEY,
    Buffer.from(iv, "hex")
  );
  let decrypted = decipher.update(Buffer.from(encrypted, "hex"), "utf8");
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
};
