const { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;
const PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/;
const VAULT_VERSION = 1;
const MAX_IMPORT_CODES = 20;

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

// The vault lets a logged-in Admin read back the active codes. It is encrypted
// with a key derived from JWT_SECRET, so a stolen database dump on its own is
// not enough to recover the codes.
function deriveVaultKey(secret) {
  if (typeof secret !== "string" || !secret.trim()) {
    throw new Error("JWT_SECRET must be set to read or store recovery codes.");
  }
  return scryptSync(secret, "possia-recovery-codes", 32);
}

function sealCodes(codes, secret) {
  const key = deriveVaultKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(codes), "utf8"),
    cipher.final()
  ]);
  return JSON.stringify({
    v: VAULT_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  });
}

// Returns null when the box is missing, unreadable, or was sealed with a
// different JWT_SECRET.
function unsealCodes(box, secret) {
  if (typeof box !== "string" || !box.trim()) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(box);
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== VAULT_VERSION) {
    return null;
  }
  try {
    const key = deriveVaultKey(secret);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parsed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final()
    ]).toString("utf8");
    const codes = JSON.parse(plain);
    return Array.isArray(codes) ? codes : null;
  } catch {
    // Wrong key (for example after JWT_SECRET rotation) or tampered data.
    return null;
  }
}

// Parses an imported list. Accepts strings or arrays, ignores blank lines,
// and reports the 1-based source line number of every problem so the Admin
// can fix the file.
function parseImportedCodes(input) {
  const rawLines = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\r?\n/)
      : [];

  const codes = [];
  const errors = [];
  const seen = new Map();

  rawLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const code = normalizeRecoveryCode(line);
    if (!code) {
      return;
    }
    if (!PATTERN.test(code)) {
      errors.push(`Line ${lineNumber}: "${String(line).trim()}" is not a valid code.`);
      return;
    }
    if (seen.has(code)) {
      errors.push(`Line ${lineNumber}: duplicates line ${seen.get(code)}.`);
      return;
    }
    seen.set(code, lineNumber);
    codes.push(code);
  });

  if (codes.length === 0 && errors.length === 0) {
    errors.push("The file contained no recovery codes.");
  }
  if (codes.length + errors.length > MAX_IMPORT_CODES) {
    errors.push(`Import at most ${MAX_IMPORT_CODES} codes at a time.`);
  }

  return { codes, errors };
}

module.exports = {
  MAX_IMPORT_CODES,
  PATTERN,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  parseImportedCodes,
  sealCodes,
  unsealCodes,
};
