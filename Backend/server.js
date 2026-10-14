const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const { randomBytes, timingSafeEqual } = require("crypto");
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
const { generateUniqueBarcode } = require("./utils/barcode");
const { getReportPeriod } = require("./utils/report-period");
const {
  PATTERN: ADMIN_RECOVERY_CODE_PATTERN,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} = require("./utils/recovery-codes");

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const ADMIN_RECOVERY_CODE_COUNT = Number(process.env.ADMIN_RECOVERY_CODE_COUNT) || 8;
const ADMIN_RECOVERY_CODE_LOW_WARNING = 2;
const GENERIC_RESET_MESSAGE =
  "That recovery code or username is not valid.";

const app = express();
app.set("trust proxy", 1);
// Frontend is hosted separately on Vercel; the backend is API-only.
// Set FRONTEND_URL on Render to the Vercel URL (comma-separated for previews),
// e.g. FRONTEND_URL=https://possia-apbmerchandising.vercel.app
const frontendOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["https://possia-apbmerchandising.vercel.app"];

app.use(
  cors({
    origin: frontendOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

app.use(express.json());

// Health routes (Render health checks + API status; no static UI served here).
app.get("/", (req, res) => {
  res.json({ message: "POSSIA API is running." });
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
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

    const user = await User.findById(decoded.userId)
      .select("_id username fullName role tokenVersion isActive");
    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }
    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({
        message: "Session expired. Please sign in again.",
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
    const products = await Product.find({ isActive: { $ne: false } })
      .select("_id barcode productName unitPrice stockQuantity")
      .sort({ productName: 1 });

    res.json({
      products: products.map((product) => ({
        id: product._id,
        barcode: product.barcode || "",
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

// Inventory is viewable by all signed-in users; management remains Admin-only.
app.get("/api/inventory", requireAuth, async (req, res) => {
  try {
    const filter = req.authUser.role === "Admin" ? {} : { isActive: { $ne: false } };
    const products = await Product.find(filter)
      .select("_id categoryId barcode productName unitPrice stockQuantity isActive")
      .populate("categoryId", "categoryName")
      .sort({ productName: 1 });
    const categories = await Category.find()
      .select("_id categoryName")
      .sort({ categoryName: 1 });

    res.json({
      products: products.map((product) => ({
        id: product._id,
        barcode: product.barcode || "",
        productName: product.productName,
        categoryId: product.categoryId?._id || product.categoryId,
        categoryName: product.categoryId?.categoryName || "Uncategorized",
        unitPrice: product.unitPrice,
        stockQuantity: product.stockQuantity,
        isActive: product.isActive !== false,
      })),
      categories: categories.map((category) => ({
        id: category._id,
        categoryName: category.categoryName,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Unable to load inventory.",
    });
  }
});

// Complete a sale atomically with its details, payment, receipt, and stock updates.
app.post("/api/sales", requireAuth, async (req, res) => {
  const { items, discount, paymentMethod, amountPaid, referenceNumber } = req.body || {};
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 100 ||
    items.some((item) =>
      !item ||
      typeof item.productId !== "string" ||
      !mongoose.Types.ObjectId.isValid(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) ||
    new Set(items.map((item) => item.productId)).size !== items.length ||
    !Number.isFinite(discount) ||
    discount < 0 ||
    !["Cash", "GCash"].includes(paymentMethod)
  ) {
    return res.status(400).json({
      message: "Invalid sale details.",
    });
  }

  if (
    (paymentMethod === "Cash" && (!Number.isFinite(amountPaid) || amountPaid < 0)) ||
    (paymentMethod === "GCash" &&
      (typeof referenceNumber !== "string" || !/^\d{13}$/.test(referenceNumber.trim())))
  ) {
    return res.status(400).json({
      message: paymentMethod === "Cash"
        ? "Enter a valid cash amount received."
        : "GCash reference number must contain exactly 13 digits.",
    });
  }

  const session = await mongoose.startSession();
  let completedSale;
  try {
    await session.withTransaction(async () => {
      const productIds = items.map((item) => new mongoose.Types.ObjectId(item.productId));
      const products = await Product.find({ _id: { $in: productIds } }).session(session);
      const productsById = new Map(products.map((product) => [product._id.toString(), product]));
      let subtotalCents = 0;
      const saleItems = items.map((item) => {
        const product = productsById.get(item.productId);
        if (!product || product.isActive === false) {
          throw Object.assign(new Error("An item in this order no longer exists."), { status: 409 });
        }
        if (product.stockQuantity < item.quantity) {
          throw Object.assign(new Error(`${product.productName} does not have enough stock.`), { status: 409 });
        }

        const unitPriceCents = Math.round(product.unitPrice * 100);
        const lineTotalCents = unitPriceCents * item.quantity;
        subtotalCents += lineTotalCents;
        return { item, product, unitPriceCents, lineTotalCents };
      });
      const discountCents = Math.round(discount * 100);
      if (discountCents > subtotalCents) {
        throw Object.assign(new Error("Discount cannot exceed the subtotal."), { status: 400 });
      }

      const totalCents = subtotalCents - discountCents;
      const paidCents = paymentMethod === "Cash"
        ? Math.round(amountPaid * 100)
        : totalCents;
      if (paidCents < totalCents) {
        throw Object.assign(new Error("Cash received is less than the total due."), { status: 400 });
      }

      const [sale] = await Sale.create([{
        userId: req.authUser._id,
        subtotal: subtotalCents / 100,
        discount: discountCents / 100,
        totalAmount: totalCents / 100,
        status: "Completed",
      }], { session });

      await SaleDetail.insertMany(
        saleItems.map(({ item, product, unitPriceCents, lineTotalCents }) => ({
          saleId: sale._id,
          productId: product._id,
          productName: product.productName,
          barcode: product.barcode,
          quantity: item.quantity,
          unitPrice: unitPriceCents / 100,
          subtotal: lineTotalCents / 100,
        })),
        { session }
      );

      for (const { item, product } of saleItems) {
        const update = await Product.updateOne(
          { _id: product._id, isActive: { $ne: false }, stockQuantity: { $gte: item.quantity } },
          { $inc: { stockQuantity: -item.quantity } },
          { session }
        );
        if (update.modifiedCount !== 1) {
          throw Object.assign(new Error(`${product.productName} stock changed. Refresh items and try again.`), { status: 409 });
        }
        await StockOut.create([{
          productId: product._id,
          productName: product.productName,
          barcode: product.barcode,
          userId: req.authUser._id,
          quantityRemoved: item.quantity,
          reason: "POS sale",
        }], { session });
      }

      const [payment] = await Payment.create([{
        saleId: sale._id,
        paymentMethod,
        amountPaid: paidCents / 100,
        changeAmount: (paidCents - totalCents) / 100,
        referenceNumber: paymentMethod === "GCash" ? referenceNumber.trim() : null,
      }], { session });

      const receiptNumber = `POSSIA-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const [receipt] = await Receipt.create([{
        paymentId: payment._id,
        userId: req.authUser._id,
        receiptNumber,
      }], { session });

      completedSale = {
        receiptNumber,
        receiptDate: receipt.receiptDate,
        cashier: req.authUser.fullName,
        items: saleItems.map(({ item, product, unitPriceCents, lineTotalCents }) => ({
          productName: product.productName,
          barcode: product.barcode,
          quantity: item.quantity,
          unitPrice: unitPriceCents / 100,
          subtotal: lineTotalCents / 100,
        })),
        subtotal: subtotalCents / 100,
        discount: discountCents / 100,
        totalAmount: totalCents / 100,
        paymentMethod,
        amountPaid: paidCents / 100,
        changeAmount: (paidCents - totalCents) / 100,
        referenceNumber: paymentMethod === "GCash" ? referenceNumber.trim() : null,
      };
    });

    res.status(201).json({
      message: "Sale completed successfully.",
      sale: completedSale,
      receipt: completedSale,
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to complete sale.",
    });
  } finally {
    await session.endSession();
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

    // Archived accounts are rejected with the same message so archived
    // usernames cannot be probed.
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

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}

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

// Admin-only self-service: the forgot-password form for the single Admin account.
app.post("/api/password/reset", async (req, res) => {
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

function recoveryCodesStatus(hashes) {
  const total = Array.isArray(hashes) ? hashes.length : 0;
  return {
    recoveryCodesRemaining: total,
    recoveryCodesTotal: ADMIN_RECOVERY_CODE_COUNT,
    recoveryCodesLow: total > 0 && total <= ADMIN_RECOVERY_CODE_LOW_WARNING,
  };
}

// Admin Settings lets the Admin mint a fresh set while still logged in.
app.post("/api/admin/recovery-codes/regenerate", requireAdmin, async (req, res) => {
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

function isValidInventoryProductInput(input, { partial = false, allowBlankBarcode = false } = {}) {
  const fields = ["productName", "categoryId", "unitPrice"];
  const allFields = [...fields, "barcode"];
  if (!partial && fields.some((field) => input[field] === undefined)) {
    return false;
  }
  if (partial && allFields.every((field) => input[field] === undefined)) {
    return false;
  }
  const barcodeIsBlank = input.barcode === undefined ||
    input.barcode === null ||
    (typeof input.barcode === "string" && input.barcode.trim().length === 0);
  const barcodeValid = allowBlankBarcode
    ? barcodeIsBlank || typeof input.barcode === "string"
    : input.barcode === undefined ||
      input.barcode === null ||
      (typeof input.barcode === "string" && input.barcode.trim().length > 0);
  return (
    barcodeValid &&
    (input.productName === undefined || (typeof input.productName === "string" && input.productName.trim().length > 0)) &&
    (input.categoryId === undefined || (
      typeof input.categoryId === "string" && mongoose.Types.ObjectId.isValid(input.categoryId)
    )) &&
    (input.unitPrice === undefined || (Number.isFinite(input.unitPrice) && input.unitPrice >= 0))
  );
}

function inventoryProductResponse(product, category) {
  return {
    id: product._id,
    barcode: product.barcode || "",
    productName: product.productName,
    categoryId: category?._id || product.categoryId,
    categoryName: category?.categoryName || "Uncategorized",
    unitPrice: product.unitPrice,
    stockQuantity: product.stockQuantity,
    isActive: product.isActive !== false,
  };
}

app.post("/api/admin/inventory/categories", requireAdmin, async (req, res) => {
  const { categoryName } = req.body || {};
  if (
    typeof categoryName !== "string" ||
    categoryName.trim().length < 2 ||
    categoryName.trim().length > 100
  ) {
    return res.status(400).json({ message: "Category name must be between 2 and 100 characters." });
  }
  try {
    const category = await Category.create({ categoryName: categoryName.trim() });
    res.status(201).json({
      message: "Category created successfully.",
      category: { id: category._id, categoryName: category.categoryName },
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(409).json({ message: "A category with that name already exists." });
    }
    res.status(500).json({ message: "Unable to create category." });
  }
});

app.put("/api/admin/inventory/categories/:categoryId", requireAdmin, async (req, res) => {
  const { categoryId } = req.params;
  const { categoryName } = req.body || {};
  if (
    !mongoose.Types.ObjectId.isValid(categoryId) ||
    typeof categoryName !== "string" ||
    categoryName.trim().length < 2 ||
    categoryName.trim().length > 100
  ) {
    return res.status(400).json({ message: "Provide a valid category ID and a name between 2 and 100 characters." });
  }
  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }
    category.categoryName = categoryName.trim();
    await category.save();
    res.json({
      message: "Category renamed successfully.",
      category: { id: category._id, categoryName: category.categoryName },
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(409).json({ message: "A category with that name already exists." });
    }
    res.status(500).json({ message: "Unable to rename category." });
  }
});

app.delete("/api/admin/inventory/categories/:categoryId", requireAdmin, async (req, res) => {
  const { categoryId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    return res.status(400).json({ message: "Invalid category ID." });
  }
  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }
    if (await Product.exists({ categoryId })) {
      return res.status(409).json({ message: "This category is assigned to products and cannot be deleted." });
    }
    await category.deleteOne();
    res.json({ message: "Category deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to delete category." });
  }
});

// Generate an unused in-store EAN-13 barcode for an explicit preview request.
app.get("/api/admin/inventory/next-barcode", requireAdmin, async (req, res) => {
  try {
    const barcode = await generateUniqueBarcode(Product);
    res.json({ barcode });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to generate a barcode.",
    });
  }
});

app.post("/api/admin/inventory/products", requireAdmin, async (req, res) => {
  const { barcode, productName, categoryId, unitPrice, initialQuantity = 0 } = req.body || {};
  if (
    typeof barcode !== "string" ||
    !barcode.trim() ||
    !isValidInventoryProductInput({ barcode, productName, categoryId, unitPrice }) ||
    !Number.isInteger(initialQuantity) ||
    initialQuantity < 0
  ) {
    return res.status(400).json({ message: "Enter a barcode, product name, category, valid price, and whole-number initial quantity." });
  }

  const session = await mongoose.startSession();
  try {
    let createdProduct;
    await session.withTransaction(async () => {
      const category = await Category.findById(categoryId).session(session);
      if (!category) {
        throw Object.assign(new Error("Category not found."), { status: 400 });
      }
      const [product] = await Product.create([{
        barcode: barcode.trim(),
        productName: productName.trim(),
        categoryId,
        unitPrice,
        stockQuantity: initialQuantity,
      }], { session });
      if (initialQuantity > 0) {
        await StockIn.create([{
          productId: product._id,
          productName: product.productName,
          barcode: product.barcode,
          userId: req.adminUser._id,
          quantityAdded: initialQuantity,
          reason: "Initial stock",
        }], { session });
      }
      createdProduct = inventoryProductResponse(product, category);
    });

    res.status(201).json({ message: "Product created successfully.", product: createdProduct });
  } catch (error) {
    console.error(error);
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "Barcode is already in use. Generate or enter a different barcode." });
    }
    res.status(500).json({ message: "Unable to create product." });
  } finally {
    await session.endSession();
  }
});

app.put("/api/admin/inventory/products/:productId", requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const input = req.body || {};
  if (
    !mongoose.Types.ObjectId.isValid(productId) ||
    !isValidInventoryProductInput(input, { partial: true })
  ) {
    return res.status(400).json({ message: "Provide a valid product ID and at least one valid product field." });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }
    if ((!product.barcode || !product.barcode.trim()) &&
      (typeof input.barcode !== "string" || !input.barcode.trim())) {
      return res.status(400).json({ message: "This product has no barcode. Enter one or click Generate before saving." });
    }
    if (input.categoryId !== undefined && !(await Category.exists({ _id: input.categoryId }))) {
      return res.status(400).json({ message: "Category not found." });
    }
    for (const field of ["barcode", "productName", "categoryId", "unitPrice"]) {
      if (input[field] !== undefined) {
        product[field] = typeof input[field] === "string" ? input[field].trim() : input[field];
      }
    }
    await product.save();
    const category = await Category.findById(product.categoryId).select("_id categoryName");
    res.json({ message: "Product updated successfully.", product: inventoryProductResponse(product, category) });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(409).json({ message: "Barcode is already in use. Generate or enter a different barcode." });
    }
    res.status(500).json({ message: "Unable to update product." });
  }
});

app.patch("/api/admin/inventory/products/:productId/status", requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const { isActive } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(productId) || typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Provide a valid product ID and active status." });
  }
  try {
    const product = await Product.findByIdAndUpdate(
      productId,
      { $set: { isActive } },
      { new: true, runValidators: true }
    );
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }
    res.json({ message: isActive ? "Product reactivated." : "Product archived." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to update product status." });
  }
});

async function adjustInventoryStock(req, res, direction) {
  const { productId } = req.params;
  const { quantity, reason = "" } = req.body || {};
  if (
    !mongoose.Types.ObjectId.isValid(productId) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    typeof reason !== "string" ||
    (direction === "out" && !reason.trim())
  ) {
    return res.status(400).json({
      message: direction === "out"
        ? "Enter a positive whole-number quantity and a reason."
        : "Enter a positive whole-number quantity.",
    });
  }

  const session = await mongoose.startSession();
  try {
    let updatedProduct;
    await session.withTransaction(async () => {
      const product = await Product.findById(productId).session(session);
      if (!product || product.isActive === false) {
        throw Object.assign(new Error("Active product not found."), { status: 404 });
      }
      if (direction === "out" && product.stockQuantity < quantity) {
        throw Object.assign(new Error("Stock removal cannot exceed the current quantity."), { status: 409 });
      }
      const update = await Product.updateOne(
        {
          _id: product._id,
          isActive: { $ne: false },
          ...(direction === "out" ? { stockQuantity: { $gte: quantity } } : {}),
        },
        { $inc: { stockQuantity: direction === "in" ? quantity : -quantity } },
        { session }
      );
      if (update.modifiedCount !== 1) {
        throw Object.assign(new Error("Stock changed; refresh and try again."), { status: 409 });
      }
      if (direction === "in") {
        await StockIn.create([{
          productId: product._id,
          productName: product.productName,
          barcode: product.barcode,
          userId: req.adminUser._id,
          quantityAdded: quantity,
          reason: reason.trim() || "Stock received",
        }], { session });
      } else {
        await StockOut.create([{
          productId: product._id,
          productName: product.productName,
          barcode: product.barcode,
          userId: req.adminUser._id,
          quantityRemoved: quantity,
          reason: reason.trim(),
        }], { session });
      }
      updatedProduct = await Product.findById(product._id).session(session);
    });
    res.json({
      message: direction === "in" ? "Stock received successfully." : "Stock removed successfully.",
      stockQuantity: updatedProduct.stockQuantity,
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to adjust stock.",
    });
  } finally {
    await session.endSession();
  }
}

app.post("/api/admin/inventory/products/:productId/stock-in", requireAdmin, (req, res) =>
  adjustInventoryStock(req, res, "in")
);
app.post("/api/admin/inventory/products/:productId/stock-out", requireAdmin, (req, res) =>
  adjustInventoryStock(req, res, "out")
);

app.get("/api/admin/inventory/movements", requireAdmin, async (req, res) => {
  try {
    const [stockIns, stockOuts] = await Promise.all([
      StockIn.find().sort({ dateReceived: -1 }).limit(100)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
      StockOut.find().sort({ dateRemoved: -1 }).limit(100)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
    ]);
    const movements = [
      ...stockIns.map((entry) => ({
        type: "Stock in",
        productName: entry.productName || entry.productId?.productName || "Unknown product",
        barcode: entry.barcode || entry.productId?.barcode || "",
        quantity: entry.quantityAdded,
        reason: entry.reason || "Stock received",
        user: entry.userId?.fullName || entry.userId?.username || "Unknown user",
        date: entry.dateReceived,
      })),
      ...stockOuts.map((entry) => ({
        type: "Stock out",
        productName: entry.productName || entry.productId?.productName || "Unknown product",
        barcode: entry.barcode || entry.productId?.barcode || "",
        quantity: entry.quantityRemoved,
        reason: entry.reason,
        user: entry.userId?.fullName || entry.userId?.username || "Unknown user",
        date: entry.dateRemoved,
      })),
    ].sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 100);
    res.json({ movements });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to load stock history." });
  }
});

// Period-filtered stock movement history for the Reports tab.
app.get("/api/admin/reports/movements", requireAdmin, async (req, res) => {
  const { period, date } = req.query;
  const range = getReportPeriod(period, date);
  if (!range) {
    return res.status(400).json({ message: "Choose a valid report period and a date that is not in the future." });
  }

  try {
    const [stockIns, stockOuts] = await Promise.all([
      StockIn.find({ dateReceived: { $gte: range.start, $lt: range.end } })
        .sort({ dateReceived: -1 }).limit(500)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
      StockOut.find({ dateRemoved: { $gte: range.start, $lt: range.end } })
        .sort({ dateRemoved: -1 }).limit(500)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
    ]);
    const movements = [
      ...stockIns.map((entry) => ({
        type: "Stock in",
        productName: entry.productName || entry.productId?.productName || "Unknown product",
        barcode: entry.barcode || entry.productId?.barcode || "",
        quantity: entry.quantityAdded,
        reason: entry.reason || "Stock received",
        user: entry.userId?.fullName || entry.userId?.username || "Unknown user",
        date: entry.dateReceived,
      })),
      ...stockOuts.map((entry) => ({
        type: "Stock out",
        productName: entry.productName || entry.productId?.productName || "Unknown product",
        barcode: entry.barcode || entry.productId?.barcode || "",
        quantity: entry.quantityRemoved,
        reason: entry.reason,
        user: entry.userId?.fullName || entry.userId?.username || "Unknown user",
        date: entry.dateRemoved,
      })),
    ].sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 500);
    const summary = {
      movementCount: movements.length,
      stockInCount: movements.filter((movement) => movement.type === "Stock in").length,
      stockOutCount: movements.filter((movement) => movement.type === "Stock out").length,
      unitsIn: movements
        .filter((movement) => movement.type === "Stock in")
        .reduce((sum, movement) => sum + (movement.quantity || 0), 0),
      unitsOut: movements
        .filter((movement) => movement.type === "Stock out")
        .reduce((sum, movement) => sum + (movement.quantity || 0), 0),
    };
    res.json({ period, startDate: range.start, endDateExclusive: range.end, summary, movements });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to generate stock movement report." });
  }
});

app.get("/api/admin/reports/sales", requireAdmin, async (req, res) => {
  const { period, date, payment } = req.query;
  const range = getReportPeriod(period, date);
  if (!range) {
    return res.status(400).json({ message: "Choose a valid report period and a date that is not in the future." });
  }
  const paymentFilter = payment === "Cash" || payment === "GCash" ? payment : null;

  try {
    const sales = await Sale.find({
      status: "Completed",
      saleDate: { $gte: range.start, $lt: range.end },
    })
      .select("_id userId saleDate subtotal discount totalAmount")
      .populate("userId", "fullName username")
      .sort({ saleDate: -1 });
    const saleIds = sales.map((sale) => sale._id);
    const [details, payments] = await Promise.all([
      saleIds.length
        ? SaleDetail.find({ saleId: { $in: saleIds } })
            .select("saleId productId productName barcode quantity unitPrice subtotal")
            .populate("productId", "categoryId")
        : [],
      saleIds.length
        ? Payment.find({ saleId: { $in: saleIds } })
            .select("_id saleId paymentMethod amountPaid changeAmount referenceNumber")
        : [],
    ]);
    const categoryIds = [...new Set(
      details.map((detail) => detail.productId?.categoryId?.toString()).filter(Boolean)
    )];
    const categories = categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds } }).select("_id categoryName")
      : [];
    const categoryNamesById = new Map(
      categories.map((category) => [category._id.toString(), category.categoryName])
    );
    const paymentIds = payments.map((payment) => payment._id);
    const receipts = paymentIds.length
      ? await Receipt.find({ paymentId: { $in: paymentIds } }).select("paymentId receiptNumber")
      : [];
    const detailsBySale = new Map();
    for (const detail of details) {
      const key = detail.saleId.toString();
      if (!detailsBySale.has(key)) {
        detailsBySale.set(key, []);
      }
      detailsBySale.get(key).push({
        productName: detail.productName || "Unknown product",
        barcode: detail.barcode || "",
        quantity: detail.quantity,
        unitPrice: detail.unitPrice,
        subtotal: detail.subtotal,
      });
    }
    const paymentsBySale = new Map(payments.map((payment) => [payment.saleId.toString(), payment]));
    const receiptsByPayment = new Map(receipts.map((receipt) => [receipt.paymentId.toString(), receipt]));
    const allTransactions = sales.map((sale) => {
      const salePayment = paymentsBySale.get(sale._id.toString());
      return {
        saleId: sale._id,
        date: sale.saleDate,
        receiptNumber: salePayment ? receiptsByPayment.get(salePayment._id.toString())?.receiptNumber || "" : "",
        cashier: sale.userId?.fullName || sale.userId?.username || "Unknown user",
        paymentMethod: salePayment?.paymentMethod || "Unknown",
        amountPaid: salePayment?.amountPaid ?? sale.totalAmount,
        changeAmount: salePayment?.changeAmount ?? 0,
        referenceNumber: salePayment?.referenceNumber || "",
        subtotal: sale.subtotal,
        discount: sale.discount,
        totalAmount: sale.totalAmount,
        items: detailsBySale.get(sale._id.toString()) || [],
      };
    });
    const transactions = paymentFilter
      ? allTransactions.filter((transaction) => transaction.paymentMethod === paymentFilter)
      : allTransactions;
    const includedSaleIds = new Set(transactions.map((transaction) => transaction.saleId.toString()));
    const includedDetails = details.filter((detail) => includedSaleIds.has(detail.saleId.toString()));
    for (const transaction of transactions) {
      delete transaction.saleId;
    }

    const paymentTotals = {};
    const paymentStats = new Map();
    let grossSales = 0;
    let discounts = 0;
    let netSales = 0;
    for (const transaction of transactions) {
      grossSales += transaction.subtotal;
      discounts += transaction.discount;
      netSales += transaction.totalAmount;
      paymentTotals[transaction.paymentMethod] =
        (paymentTotals[transaction.paymentMethod] || 0) + transaction.totalAmount;
      const paymentEntry = paymentStats.get(transaction.paymentMethod) || {
        paymentMethod: transaction.paymentMethod,
        transactions: 0,
        totalCents: 0,
      };
      paymentEntry.transactions += 1;
      paymentEntry.totalCents += Math.round(transaction.totalAmount * 100);
      paymentStats.set(transaction.paymentMethod, paymentEntry);
    }
    const paymentBreakdown = Array.from(paymentStats.values())
      .map(({ totalCents, transactions: count, ...rest }) => ({
        ...rest,
        transactions: count,
        totalSales: totalCents / 100,
        averageTicket: count ? totalCents / 100 / count : 0,
      }))
      .sort((left, right) => right.totalSales - left.totalSales);

    const productSales = new Map();
    const categorySales = new Map();
    for (const detail of includedDetails) {
      const productKey = detail.productId?._id?.toString() || detail.productId?.toString() ||
        `${detail.barcode || ""}:${detail.productName || "Unknown product"}`;
      const product = productSales.get(productKey) || {
        productName: detail.productName || "Unknown product",
        barcode: detail.barcode || "",
        unitsSold: 0,
        revenueCents: 0,
      };
      product.unitsSold += detail.quantity;
      product.revenueCents += Math.round(detail.subtotal * 100);
      productSales.set(productKey, product);
      const categoryName = categoryNamesById.get(detail.productId?.categoryId?.toString()) || "Uncategorized";
      const category = categorySales.get(categoryName) || {
        categoryName,
        unitsSold: 0,
        revenueCents: 0,
      };
      category.unitsSold += detail.quantity;
      category.revenueCents += Math.round(detail.subtotal * 100);
      categorySales.set(categoryName, category);
    }
    const mostPurchasedProducts = Array.from(productSales.values())
      .map((product) => ({
        ...product,
        revenue: product.revenueCents / 100,
      }))
      .sort((left, right) =>
        right.unitsSold - left.unitsSold ||
        left.productName.localeCompare(right.productName)
      )
      .slice(0, 10)
      .map(({ revenueCents, ...product }) => product);
    const categoryBreakdown = Array.from(categorySales.values())
      .map(({ revenueCents, ...category }) => ({
        ...category,
        revenue: revenueCents / 100,
      }))
      .sort((left, right) =>
        right.revenue - left.revenue || left.categoryName.localeCompare(right.categoryName)
      );

    const discountedTransactions = transactions
      .filter((transaction) => transaction.discount > 0)
      .map((transaction) => ({
        date: transaction.date,
        receiptNumber: transaction.receiptNumber,
        cashier: transaction.cashier,
        paymentMethod: transaction.paymentMethod,
        discount: transaction.discount,
        totalAmount: transaction.totalAmount,
      }));

    const manilaDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const manilaDayLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila", month: "short", day: "numeric",
    });
    const manilaHour = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila", hour: "2-digit", hour12: false,
    });
    const manilaMonthKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit",
    });
    const manilaMonthLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila", month: "short", year: "numeric",
    });
    const granularity = period === "daily" ? "hour" : period === "yearly" ? "month" : "day";
    const trendBuckets = new Map();
    if (granularity === "hour") {
      for (let hour = 0; hour < 24; hour += 1) {
        const label = `${String(hour).padStart(2, "0")}:00`;
        trendBuckets.set(label, { label, netCents: 0, transactions: 0 });
      }
    } else if (granularity === "month") {
      const cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
      const end = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), 1));
      while (cursor < end) {
        const key = manilaMonthKey.format(cursor);
        trendBuckets.set(key, { label: manilaMonthLabel.format(cursor), netCents: 0, transactions: 0 });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else {
      const cursor = new Date(range.start);
      while (cursor < range.end) {
        const key = manilaDay.format(cursor);
        if (!trendBuckets.has(key)) {
          trendBuckets.set(key, { label: manilaDayLabel.format(cursor), netCents: 0, transactions: 0 });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    for (const transaction of transactions) {
      const saleDate = new Date(transaction.date);
      const key = granularity === "hour"
        ? `${String(Number(manilaHour.format(saleDate)) % 24).padStart(2, "0")}:00`
        : granularity === "month"
          ? manilaMonthKey.format(saleDate)
          : manilaDay.format(saleDate);
      const bucket = trendBuckets.get(key);
      if (bucket) {
        bucket.netCents += Math.round(transaction.totalAmount * 100);
        bucket.transactions += 1;
      }
    }
    const trend = {
      granularity,
      buckets: Array.from(trendBuckets.values()).map(({ netCents, ...bucket }) => ({
        ...bucket,
        netSales: netCents / 100,
      })),
    };

    res.json({
      period,
      startDate: range.start,
      endDateExclusive: range.end,
      filters: { payment: paymentFilter },
      summary: {
        salesCount: transactions.length,
        grossSales,
        discounts,
        netSales,
        paymentTotals,
      },
      transactions,
      mostPurchasedProducts,
      categoryBreakdown,
      paymentBreakdown,
      trend,
      discountedTransactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to generate sales report." });
  }
});

app.get("/api/admin/reports/inventory", requireAdmin, async (req, res) => {
  try {
    const products = await Product.find()
      .select("_id barcode productName categoryId unitPrice stockQuantity isActive")
      .populate("categoryId", "categoryName")
      .sort({ productName: 1 });
    let totalUnits = 0;
    let totalValue = 0;
    const inventory = products.map((product) => {
      const stockValue = product.unitPrice * product.stockQuantity;
      totalUnits += product.stockQuantity;
      totalValue += stockValue;
      return {
        barcode: product.barcode || "",
        productName: product.productName,
        categoryName: product.categoryId?.categoryName || "Uncategorized",
        stockQuantity: product.stockQuantity,
        unitPrice: product.unitPrice,
        stockValue,
        status: product.isActive === false ? "Archived" : "Active",
      };
    });
    const lowStockThreshold = 10;
    const lowStockProducts = inventory.filter((product) =>
      product.status === "Active" && product.stockQuantity <= lowStockThreshold
    );
    res.json({
      generatedAt: new Date(),
      lowStockThreshold,
      summary: {
        productCount: inventory.length,
        totalUnits,
        totalValue,
        lowStockCount: lowStockProducts.length,
      },
      products: inventory,
      lowStockProducts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to generate inventory report." });
  }
});

// List accounts (Admin only)
app.get("/api/admin/users", requireAdmin, async (req, res) => {
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

// Create an account (Admin only). The single Admin is created by the operator,
// so accounts created here are always Staff.
app.post("/api/admin/users", requireAdmin, async (req, res) => {
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

// Archive an account (Admin only). Accounts are never hard-deleted so they
// can be reactivated; archiving also bumps tokenVersion to end sessions.
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

// Reactivate an archived account (Admin only)
app.patch("/api/admin/users/:userId/status", requireAdmin, async (req, res) => {
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
    const user = await User.findById(decoded.userId).select("_id username fullName role isActive");
    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

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
