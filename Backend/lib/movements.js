// Merges stock-in and stock-out documents into one newest-first movement list.
function toMovementList(stockIns, stockOuts, limit) {
  return [
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
  ].sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, limit);
}

// Totals a movement list by direction for report summaries.
function summarizeMovements(movements) {
  return {
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
}

module.exports = { toMovementList, summarizeMovements };