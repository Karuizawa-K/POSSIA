const express = require("express");
const mongoose = require("mongoose");
const { randomBytes } = require("crypto");

const User = require("../models/users");
const Product = require("../models/products");
const Sale = require("../models/sales");
const SaleDetail = require("../models/sale_details");
const Payment = require("../models/payment");
const Receipt = require("../models/receipt");
const StockOut = require("../models/stock_out");
const { requireAuth } = require("../middleware/auth");
const { httpError } = require("../lib/http-error");

const router = express.Router();

router.get("/api/products", requireAuth, async (req, res) => {
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

router.post("/api/sales", requireAuth, async (req, res) => {
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
          throw httpError("An item in this order no longer exists.", 409);
        }
        if (product.stockQuantity < item.quantity) {
          throw httpError(`${product.productName} does not have enough stock.`, 409);
        }

        const unitPriceCents = Math.round(product.unitPrice * 100);
        const lineTotalCents = unitPriceCents * item.quantity;
        subtotalCents += lineTotalCents;
        return { item, product, unitPriceCents, lineTotalCents };
      });
      const discountCents = Math.round(discount * 100);
      if (discountCents > subtotalCents) {
        throw httpError("Discount cannot exceed the subtotal.", 400);
      }

      const totalCents = subtotalCents - discountCents;
      const paidCents = paymentMethod === "Cash"
        ? Math.round(amountPaid * 100)
        : totalCents;
      if (paidCents < totalCents) {
        throw httpError("Cash received is less than the total due.", 400);
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
          throw httpError(`${product.productName} stock changed. Refresh items and try again.`, 409);
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

module.exports = router;