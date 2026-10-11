const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Import DB models
const User = require("./models/users");
const Category = require("./models/categories");
const Product = require("./models/products");
const Sale = require("./models/sales");
const SaleDetail = require("./models/sale_details");
const Payment = require("./models/payment");
const Receipt = require("./models/receipt");
const StockIn = require("./models/stock_in");
const StockOut = require("./models/stock_out");

const app = express();
const frontendOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((origin) => origin.trim())
  : true;

app.use(
  cors({
    origin: frontendOrigins,
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "Frontend")));

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Login API is running." });
});

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }

  try {
    const decoded = jwt.verify(
      authHeader.slice("Bearer ".length),
      process.env.JWT_SECRET
    );
    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return res.status(401).json({
        message: "Invalid or expired token.",
      });
    }

    const user = await User.findById(decoded.userId).select("_id username fullName role");
    if (!user) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    req.authUser = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Invalid or expired token.",
      });
    }
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
}

// List products for the point-of-sale catalog
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const products = await Product.find()
      .select("_id barcode productName unitPrice stockQuantity")
      .sort({ productName: 1 });

    res.json({
      products: products.map((product) => ({
        id: product._id,
        barcode: product.barcode,
        productName: product.productName,
        unitPrice: product.unitPrice,
        stockQuantity: product.stockQuantity,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Unable to load products.",
    });
  }
});

// Login
app.post("/api/login", async (req, res) => {
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

    if (!user) {
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
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.authUser.role !== "Admin") {
      return res.status(403).json({
        message: "Admin access is required.",
      });
    }

    req.adminUser = req.authUser;
    next();
  });
}

// List accounts (Admin only)
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("_id username fullName role createdAt")
      .sort({ username: 1 });

    res.json({
      users: users.map((user) => ({
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
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

// Create an account (Admin only)
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { username, fullName, password, role } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof fullName !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !fullName.trim() ||
      !password ||
      !["Admin", "Staff"].includes(role)
    ) {
      return res.status(400).json({
        message: "Username, full name, password, and a valid role are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters.",
      });
    }

    const normalizedUsername = username.trim();
    const existingUser = await User.findOne({ username: normalizedUsername });
    if (existingUser) {
      return res.status(409).json({
        message: "Username is already registered.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      fullName: fullName.trim(),
      password: hashedPassword,
      role,
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

// Edit an account (Admin only)
app.put("/api/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
    }

    const { username, fullName, password, role } = req.body || {};
    if (
      (username !== undefined && (typeof username !== "string" || !username.trim())) ||
      (fullName !== undefined && (typeof fullName !== "string" || !fullName.trim())) ||
      (password !== undefined && typeof password !== "string") ||
      (role !== undefined && !["Admin", "Staff"].includes(role)) ||
      (username === undefined && fullName === undefined && password === undefined && role === undefined)
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

    if (
      user._id.toString() === req.adminUser._id.toString() &&
      role !== undefined &&
      role !== user.role
    ) {
      return res.status(400).json({
        message: "You cannot change your own role.",
      });
    }

    if (username !== undefined) {
      user.username = username.trim();
    }
    if (fullName !== undefined) {
      user.fullName = fullName.trim();
    }
    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    if (role !== undefined && user.role === "Admin" && role !== "Admin") {
      const adminCount = await User.countDocuments({ role: "Admin" });
      if (adminCount <= 1) {
        return res.status(409).json({
          message: "The last Admin account cannot be changed to Staff.",
        });
      }
    }
    if (role !== undefined) {
      user.role = role;
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

// Delete an account (Admin only)
app.delete("/api/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
    }
    if (req.adminUser._id.toString() === userId) {
      return res.status(400).json({
        message: "You cannot delete your own account.",
      });
    }

    const user = await User.findById(userId).select("_id role");
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }
    if (user.role === "Admin") {
      const adminCount = await User.countDocuments({ role: "Admin" });
      if (adminCount <= 1) {
        return res.status(409).json({
          message: "The last Admin account cannot be deleted.",
        });
      }
    }

    await user.deleteOne();
    res.json({
      message: "User deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error.",
    });
  }
});

// Protected profile route
app.get("/api/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const token = authHeader.slice("Bearer ".length);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("_id username fullName role");
    if (!user) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    res.json({
      message: "Protected data.",
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be set to your MongoDB Atlas connection string.");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set before starting the server.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected.");

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exitCode = 1;
});