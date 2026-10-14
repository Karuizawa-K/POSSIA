const express = require("express");

const Category = require("../models/categories");
const Product = require("../models/products");
const Sale = require("../models/sales");
const SaleDetail = require("../models/sale_details");
const Payment = require("../models/payment");
const Receipt = require("../models/receipt");
const StockIn = require("../models/stock_in");
const StockOut = require("../models/stock_out");
const { requireAdmin } = require("../middleware/auth");
const { toMovementList, summarizeMovements } = require("../lib/movements");
const { getReportPeriod } = require("../utils/report-period");

// Built once at load: constructing Intl.DateTimeFormat is costly per request.
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

const router = express.Router();

router.get("/api/admin/reports/movements", requireAdmin, async (req, res) => {
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
    const movements = toMovementList(stockIns, stockOuts, 500);
    const summary = summarizeMovements(movements);
    res.json({ period, startDate: range.start, endDateExclusive: range.end, summary, movements });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Unable to generate stock movement report." });
  }
});

router.get("/api/admin/reports/sales", requireAdmin, async (req, res) => {
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

router.get("/api/admin/reports/inventory", requireAdmin, async (req, res) => {
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

module.exports = router;