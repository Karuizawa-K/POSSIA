const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/users");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const {
  GENERIC_RESET_MESSAGE,
  findMatchingRecoveryCode,
  recoveryCodesStatus,
} = require("../lib/admin-recovery");
const { USERNAME_PATTERN, normalizeUsername } = require("../lib/validators");
const {
  PATTERN: ADMIN_RECOVERY_CODE_PATTERN,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} = require("../utils/recovery-codes");

const router = express.Router();

router.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Username and password are required.",
      });
    }

    const user = await User.findOne({ username: username.trim() });

    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Invalid username or password.",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid username or password.",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    let recoveryCodes = {};
    if (user.role === "Admin") {
      const admin = await User.findById(user._id).select("+adminRecoveryCodeHashes");
      recoveryCodes = recoveryCodesStatus(admin?.adminRecoveryCodeHashes);
    }

    res.json({
      message: "Login successful.",
      token,
      user: {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        ...recoveryCodes,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

router.post("/api/password/reset", async (req, res) => {
  const { code, newPassword, confirmPassword } = req.body || {};
  const username = normalizeUsername((req.body || {}).username);
  const recoveryCode = normalizeRecoveryCode(code);

  if (
    !USERNAME_PATTERN.test(username) ||
    !ADMIN_RECOVERY_CODE_PATTERN.test(recoveryCode) ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string" ||
    newPassword.length < 6 ||
    newPassword !== confirmPassword
  ) {
    return res.status(400).json({
      message:
        "Enter your username, a recovery code (XXXX-XXXX-XXXX), and matching new passwords of at least 6 characters.",
    });
  }

  try {
    const user = await User.findOne({ username }).select("+adminRecoveryCodeHashes");
    const matchedHash =
      user && user.role === "Admin"
        ? findMatchingRecoveryCode(user.adminRecoveryCodeHashes, recoveryCode)
        : null;

    if (!matchedHash) {
      console.warn("[admin-recovery] Invalid recovery code attempt.");
      return res.status(400).json({ message: GENERIC_RESET_MESSAGE });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await User.updateOne(
      { _id: user._id, adminRecoveryCodeHashes: matchedHash },
      {
        $set: { password: hashedPassword },
        $inc: { tokenVersion: 1 },
        $pull: { adminRecoveryCodeHashes: matchedHash },
      }
    );
    if (result.modifiedCount !== 1) {
      return res.status(400).json({ message: GENERIC_RESET_MESSAGE });
    }

    const remaining = await User.findById(user._id).select("+adminRecoveryCodeHashes");
    console.log(
      `[admin-recovery] Password reset for @${user.username}; ${remaining.adminRecoveryCodeHashes.length} recovery code(s) left.`
    );

    res.json({
      message: "Password reset successfully. Sign in using your new password.",
      recoveryCodesRemaining: remaining.adminRecoveryCodeHashes.length,
    });
  } catch (error) {
    console.error("Admin recovery failed:", error);
    res.status(500).json({
      message: "Unable to reset the password. Contact your system operator.",
    });
  }
});

router.post("/api/admin/recovery-codes/regenerate", requireAdmin, async (req, res) => {
  try {
    const codes = generateRecoveryCodes();
    await User.updateOne(
      { _id: req.adminUser._id, role: "Admin" },
      { $set: { adminRecoveryCodeHashes: codes.map(hashRecoveryCode) } }
    );

    console.log(
      `[admin-recovery] New recovery codes issued to @${req.adminUser.username}.`
    );
    res.json({
      message:
        "New recovery codes generated. Save them now - they are not shown again.",
      codes,
      ...recoveryCodesStatus(codes),
    });
  } catch (error) {
    console.error("Recovery code regeneration failed:", error);
    res.status(500).json({
      message: "Unable to generate recovery codes. Try again.",
    });
  }
});

router.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const user = req.authUser;

    let recoveryCodes = {};
    if (user.role === "Admin") {
      const admin = await User.findById(user._id).select("+adminRecoveryCodeHashes");
      recoveryCodes = recoveryCodesStatus(admin?.adminRecoveryCodeHashes);
    }

    res.json({
      message: "Protected data.",
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        ...recoveryCodes,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

module.exports = router;