const express = require("express");
const mongoose = require("mongoose");

const Category = require("../models/categories");
const Product = require("../models/products");
const StockIn = require("../models/stock_in");
const StockOut = require("../models/stock_out");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { httpError } = require("../lib/http-error");
const {
  isValidInventoryProductInput,
  inventoryProductResponse,
} = require("../lib/validators");
const { toMovementList } = require("../lib/movements");
const { generateUniqueBarcode } = require("../utils/barcode");

const router = express.Router();

router.get("/api/inventory", requireAuth, async (req, res) => {
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

router.post("/api/admin/inventory/categories", requireAdmin, async (req, res) => {
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

router.put("/api/admin/inventory/categories/:categoryId", requireAdmin, async (req, res) => {
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

router.delete("/api/admin/inventory/categories/:categoryId", requireAdmin, async (req, res) => {
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

router.get("/api/admin/inventory/next-barcode", requireAdmin, async (req, res) => {
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

router.post("/api/admin/inventory/products", requireAdmin, async (req, res) => {
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
        throw httpError("Category not found.", 400);
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

router.put("/api/admin/inventory/products/:productId", requireAdmin, async (req, res) => {
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

router.patch("/api/admin/inventory/products/:productId/status", requireAdmin, async (req, res) => {
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

// Applies a stock-in or stock-out change inside a transaction.
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
        throw httpError("Active product not found.", 404);
      }
      if (direction === "out" && product.stockQuantity < quantity) {
        throw httpError("Stock removal cannot exceed the current quantity.", 409);
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
        throw httpError("Stock changed; refresh and try again.", 409);
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

router.post("/api/admin/inventory/products/:productId/stock-in", requireAdmin, (req, res) =>
  adjustInventoryStock(req, res, "in")
);

router.post("/api/admin/inventory/products/:productId/stock-out", requireAdmin, (req, res) =>
  adjustInventoryStock(req, res, "out")
);

router.get("/api/admin/inventory/movements", requireAdmin, async (req, res) => {
  try {
    const [stockIns, stockOuts] = await Promise.all([
      StockIn.find().sort({ dateReceived: -1 }).limit(100)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
      StockOut.find().sort({ dateRemoved: -1 }).limit(100)
        .populate("productId", "productName barcode")
        .populate("userId", "fullName username"),
    ]);
    const movements = toMovementList(stockIns, stockOuts, 100);
    res.json({ movements });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to load stock history." });
  }
});

module.exports = router;