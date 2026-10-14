const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/users");
const { requireAdmin } = require("../middleware/auth");
const { USERNAME_PATTERN } = require("../lib/validators");

const router = express.Router();

router.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("_id username fullName role isActive createdAt")
      .sort({ username: 1 });

    res.json({
      users: users.map((user) => ({
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive !== false,
        createdAt: user.createdAt,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

router.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { username, fullName, password, role } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof fullName !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !fullName.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Username, full name, and password are required.",
      });
    }

    const normalizedUsername = username.trim();
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      return res.status(400).json({
        message:
          "Username must be 3-32 characters and may use letters, numbers, dot, underscore, or hyphen.",
      });
    }
    if (role !== undefined && role !== "Staff") {
      return res.status(409).json({
        message: "Only one Admin account is allowed and it is created by your system operator. New accounts must be Staff.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters.",
      });
    }

    if (await User.exists({ username: normalizedUsername })) {
      return res.status(409).json({
        message: "Username is already registered.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      fullName: fullName.trim(),
      password: hashedPassword,
      role: "Staff",
    });

    return res.status(201).json({
      message: "User created successfully.",
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Username is already registered.",
      });
    }
    res.status(500).json({
      message: "Server error.",
    });
  }
});

router.put("/api/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
    }

    const { username, fullName, password, role } = req.body || {};
    if (
      (username !== undefined && !USERNAME_PATTERN.test(username.trim())) ||
      (fullName !== undefined && (typeof fullName !== "string" || !fullName.trim())) ||
      (password !== undefined && typeof password !== "string") ||
      (role !== undefined && !["Admin", "Staff"].includes(role)) ||
      (username === undefined &&
        fullName === undefined &&
        password === undefined &&
        role === undefined)
    ) {
      return res.status(400).json({
        message: "Provide valid account fields to update.",
      });
    }
    if (password !== undefined && password.length > 0 && password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters.",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const isSoleAdmin = user.role === "Admin";
    if (role !== undefined && role === "Admin" && !isSoleAdmin) {
      return res.status(409).json({
        message: "Only one Admin account is allowed and it is created by your system operator.",
      });
    }
    if (isSoleAdmin && role !== undefined && role !== "Admin") {
      return res.status(409).json({
        message: "The Admin account cannot be changed to Staff. Ask your system operator to replace it.",
      });
    }
    if (user._id.toString() === req.adminUser._id.toString() && role !== undefined) {
      return res.status(400).json({
        message: "You cannot change your own role.",
      });
    }

    if (username !== undefined) {
      const clash = await User.findOne({ username: username.trim() });
      if (clash && clash._id.toString() !== user._id.toString()) {
        return res.status(409).json({
          message: "Username is already registered.",
        });
      }
      user.username = username.trim();
    }
    if (fullName !== undefined) {
      user.fullName = fullName.trim();
    }
    if (password) {
      user.password = await bcrypt.hash(password, 10);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }

    await user.save();
    res.json({
      message: "User updated successfully.",
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Username is already registered.",
      });
    }
    res.status(500).json({
      message: "Server error.",
    });
  }
});

router.delete("/api/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
    }
    if (req.adminUser._id.toString() === userId) {
      return res.status(400).json({
        message: "You cannot archive your own account.",
      });
    }

    const user = await User.findById(userId).select("_id role isActive");
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }
    if (user.role === "Admin") {
      return res.status(409).json({
        message: "The Admin account cannot be archived. Ask your system operator to replace it.",
      });
    }
    if (user.isActive === false) {
      return res.status(409).json({
        message: "That account is already archived.",
      });
    }

    user.isActive = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    res.json({
      message: "Account archived successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

router.patch("/api/admin/users/:userId/status", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(userId) || typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "Provide a valid user ID and active status.",
      });
    }

    const user = await User.findById(userId).select("_id role isActive");
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }
    if (user.role === "Admin" && isActive === false) {
      return res.status(409).json({
        message: "The Admin account cannot be archived. Ask your system operator to replace it.",
      });
    }

    user.isActive = isActive;
    await user.save();
    res.json({
      message: isActive ? "Account reactivated." : "Account archived.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

module.exports = router;