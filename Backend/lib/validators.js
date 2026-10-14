const mongoose = require("mongoose");

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

// Trims a username for comparison.
function normalizeUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Validates product create and update payloads.
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

// Shapes a product and category into an API response.
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

module.exports = {
  USERNAME_PATTERN,
  normalizeUsername,
  isValidInventoryProductInput,
  inventoryProductResponse,
};