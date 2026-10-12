const { createHash, randomBytes } = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;
const PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/;

function hashRecoveryCode(code) {
  return createHash("sha256").update(String(code)).digest("hex");
}

// Alphabet omits I, O, 0 and 1 so codes stay readable when relayed by phone.
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
