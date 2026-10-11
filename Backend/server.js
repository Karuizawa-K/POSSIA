const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const { randomBytes } = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Import DB models
const User = require("./models/users");
const SystemSetting = require("./models/system_settings");
const Category = require("./models/categories");
const Product = require("./models/products");
const Sale = require("./models/sales");
const SaleDetail = require("./models/sale_details");
const Payment = require("./models/payment");
const Receipt = require("./models/receipt");
const StockIn = require("./models/stock_in");
const StockOut = require("./models/stock_out");
const { generateUniqueBarcode } = require("./utils/barcode");

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
app.use(
  "/vendor/zxing",
  express.static(path.join(__dirname, "node_modules", "@zxing", "browser", "umd"))
);
app.use(
  "/vendor/jsbarcode",
  express.static(path.join(__dirname, "node_modules", "jsbarcode", "dist"))
);

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

function getReportPeriod(period, dateValue) {
  if (!["daily", "weekly", "monthly", "yearly"].includes(period) ||
    typeof dateValue !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (dateValue > today) {
    return null;
  }
  const anchor = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== dateValue) {
    return null;
  }

  const start = new Date(anchor);
  const end = new Date(anchor);
  if (period === "daily") {
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (period === "weekly") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === "monthly") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 1);
  } else {
    start.setUTCMonth(0, 1);
    end.setUTCFullYear(end.getUTCFullYear() + 1, 0, 1);
  }
  return { start, end };
}

app.get("/api/admin/reports/sales", requireAdmin, async (req, res) => {
  const { period, date } = req.query;
  const range = getReportPeriod(period, date);
  if (!range) {
    return res.status(400).json({ message: "Choose a valid report period and a date that is not in the future." });
  }

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
        : [],
      saleIds.length
        ? Payment.find({ saleId: { $in: saleIds } })
            .select("_id saleId paymentMethod amountPaid changeAmount referenceNumber")
        : [],
    ]);
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
    const paymentTotals = {};
    let grossSales = 0;
    let discounts = 0;
    let netSales = 0;
    const transactions = sales.map((sale) => {
      const payment = paymentsBySale.get(sale._id.toString());
      const paymentMethod = payment?.paymentMethod || "Unknown";
      grossSales += sale.subtotal;
      discounts += sale.discount;
      netSales += sale.totalAmount;
      paymentTotals[paymentMethod] = (paymentTotals[paymentMethod] || 0) + sale.totalAmount;
      return {
        date: sale.saleDate,
        receiptNumber: payment ? receiptsByPayment.get(payment._id.toString())?.receiptNumber || "" : "",
        cashier: sale.userId?.fullName || sale.userId?.username || "Unknown user",
        paymentMethod,
        amountPaid: payment?.amountPaid ?? sale.totalAmount,
        changeAmount: payment?.changeAmount ?? 0,
        referenceNumber: payment?.referenceNumber || "",
        subtotal: sale.subtotal,
        discount: sale.discount,
        totalAmount: sale.totalAmount,
        items: detailsBySale.get(sale._id.toString()) || [],
      };
    });
    const productSales = new Map();
    for (const detail of details) {
      const productKey = detail.productId?.toString() ||
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

    res.json({
      period,
      startDate: range.start,
      endDateExclusive: range.end,
      summary: {
        salesCount: sales.length,
        grossSales,
        discounts,
        netSales,
        paymentTotals,
      },
      transactions,
      mostPurchasedProducts,
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
    const [users, ownerSetting] = await Promise.all([
      User.find()
        .select("_id username fullName role createdAt")
        .sort({ username: 1 }),
      SystemSetting.findOne({ key: "owner" }).select("ownerUserId"),
    ]);
    const ownerUserId = ownerSetting?.ownerUserId?.toString() || null;
    const ownerIsValid = users.some((user) =>
      user._id.toString() === ownerUserId && user.role === "Admin"
    );

    res.json({
      ownerConfigured: ownerIsValid,
      ownerConfigurationInvalid: Boolean(ownerSetting) && !ownerIsValid,
      currentUserIsOwner: ownerUserId === req.adminUser._id.toString(),
      users: users.map((user) => ({
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        createdAt: user.createdAt,
        isOwner: user._id.toString() === ownerUserId,
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

    const ownerSetting = await SystemSetting.findOne({ key: "owner" }).select("ownerUserId");
    const isOwner = ownerSetting?.ownerUserId?.toString() === user._id.toString();
    if (isOwner && req.adminUser._id.toString() !== user._id.toString()) {
      return res.status(403).json({
        message: "Only the system owner can edit their own account.",
      });
    }
    if (isOwner && role !== undefined && role !== "Admin") {
      return res.status(409).json({
        message: "Transfer system ownership before changing the owner's role.",
      });
    }
    if (
      user.role === "Admin" &&
      role === "Staff" &&
      ownerSetting?.ownerUserId?.toString() !== req.adminUser._id.toString()
    ) {
      return res.status(403).json({
        message: "Only the system owner can change another Admin account to Staff.",
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

    const [user, ownerSetting] = await Promise.all([
      User.findById(userId).select("_id role"),
      SystemSetting.findOne({ key: "owner" }).select("ownerUserId"),
    ]);
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }
    if (ownerSetting?.ownerUserId?.toString() === user._id.toString()) {
      return res.status(409).json({
        message: "Transfer system ownership before deleting the owner account.",
      });
    }
    if (user.role === "Admin") {
      if (ownerSetting?.ownerUserId?.toString() !== req.adminUser._id.toString()) {
        return res.status(403).json({
          message: "Only the system owner can delete another Admin account.",
        });
      }
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

app.post("/api/admin/owner-transfer", requireAdmin, async (req, res) => {
  try {
    const { targetUserId, password, confirmTransfer } = req.body || {};
    if (
      typeof targetUserId !== "string" ||
      !mongoose.Types.ObjectId.isValid(targetUserId) ||
      typeof password !== "string" ||
      !password ||
      confirmTransfer !== true
    ) {
      return res.status(400).json({
        message: "Choose an Admin, enter your password, and confirm the ownership transfer.",
      });
    }

    const ownerSetting = await SystemSetting.findOne({ key: "owner" });
    if (!ownerSetting) {
      return res.status(409).json({
        message: "System ownership is not initialized. Run npm run migrate:owner in Backend first.",
      });
    }
    if (ownerSetting.ownerUserId.toString() !== req.adminUser._id.toString()) {
      return res.status(403).json({
        message: "Only the current system owner can transfer ownership.",
      });
    }
    if (targetUserId === req.adminUser._id.toString()) {
      return res.status(400).json({
        message: "Choose a different Admin to receive ownership.",
      });
    }

    const [currentOwner, targetUser] = await Promise.all([
      User.findById(req.adminUser._id).select("password"),
      User.findById(targetUserId).select("_id username role"),
    ]);
    if (!currentOwner) {
      return res.status(409).json({ message: "Current owner account was not found; contact a trusted system operator." });
    }
    if (!await bcrypt.compare(password, currentOwner.password)) {
      return res.status(403).json({ message: "The current password is incorrect." });
    }
    if (!targetUser || targetUser.role !== "Admin") {
      return res.status(400).json({
        message: "Ownership can only be transferred to another existing Admin account.",
      });
    }

    const updatedSetting = await SystemSetting.findOneAndUpdate(
      { _id: ownerSetting._id, ownerUserId: req.adminUser._id },
      { $set: { ownerUserId: targetUser._id } },
      { new: true }
    );
    if (!updatedSetting) {
      return res.status(409).json({
        message: "Ownership changed during this request. Reload the page and try again.",
      });
    }

    res.json({
      message: `System ownership transferred to "${targetUser.username}".`,
      owner: {
        id: targetUser._id,
        username: targetUser.username,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to transfer system ownership." });
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
    const [user, ownerSetting] = await Promise.all([
      User.findById(decoded.userId).select("_id username fullName role"),
      SystemSetting.findOne({ key: "owner" }).select("ownerUserId"),
    ]);
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
        isSystemOwner: ownerSetting?.ownerUserId?.toString() === user._id.toString(),
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