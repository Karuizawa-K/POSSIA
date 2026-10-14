const { createHash, randomBytes } = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;
const PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/;

// Hashes a recovery code so only the digest is ever stored.
function hashRecoveryCode(code) {
  return createHash("sha256").update(String(code)).digest("hex");
}

// Builds one readable XXXX-XXXX-XXXX code from a phone-safe alphabet.
function generateRecoveryCode() {
  const groupSize = GROUP_LENGTH * GROUP_COUNT;
  const characters = [];
  for (let index = 0; index < groupSize; index += 1) {
    characters.push(ALPHABET[randomBytes(1)[0] % ALPHABET.length]);
  }
  return characters
    .join("")
    .replace(new RegExp(`(.{${GROUP_LENGTH}})`, "g"), "$1-")
    .replace(/-$/, "");
}

// Returns a batch of unique recovery codes.
function generateRecoveryCodes(count = 8) {
  const codes = [];
  while (codes.length < count) {
    const code = generateRecoveryCode();
    if (!codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

// Trims and upper-cases user input into a comparable recovery code.
function normalizeRecoveryCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

module.exports = {
  PATTERN,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
};