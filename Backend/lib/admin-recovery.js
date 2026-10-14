const { timingSafeEqual } = require("crypto");
const { hashRecoveryCode } = require("../utils/recovery-codes");

const ADMIN_RECOVERY_CODE_COUNT = Number(process.env.ADMIN_RECOVERY_CODE_COUNT) || 8;
const ADMIN_RECOVERY_CODE_LOW_WARNING = 2;
const GENERIC_RESET_MESSAGE =
  "That recovery code or username is not valid.";

// Finds a stored hash matching a supplied recovery code.
function findMatchingRecoveryCode(hashes, code) {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return null;
  }
  const suppliedHash = Buffer.from(hashRecoveryCode(code), "utf8");
  for (const storedHash of hashes) {
    const candidate = Buffer.from(String(storedHash), "utf8");
    if (candidate.length === suppliedHash.length && timingSafeEqual(suppliedHash, candidate)) {
      return String(storedHash);
    }
  }
  return null;
}

// Summarizes remaining recovery codes for the Admin.
function recoveryCodesStatus(hashes) {
  const total = Array.isArray(hashes) ? hashes.length : 0;
  return {
    recoveryCodesRemaining: total,
    recoveryCodesTotal: ADMIN_RECOVERY_CODE_COUNT,
    recoveryCodesLow: total > 0 && total <= ADMIN_RECOVERY_CODE_LOW_WARNING,
  };
}

module.exports = {
  ADMIN_RECOVERY_CODE_COUNT,
  GENERIC_RESET_MESSAGE,
  findMatchingRecoveryCode,
  recoveryCodesStatus,
};