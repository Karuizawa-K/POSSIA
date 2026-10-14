// apiUrl() is defined in config.js (loaded before this file) and prefixes
// paths with the Render backend URL. Fall back to same-origin when missing.
const apiUrl = window.apiUrl || ((path) => path);
const reportsPage = document.getElementById("reportsPage");
const reportForm = document.getElementById("reportForm");
const reportCategory = document.getElementById("reportCategory");
const salesPeriod = document.getElementById("salesPeriod");
const periodDate = document.getElementById("periodDate");
const reportResults = document.getElementById("reportResults");
const reportMessage = document.getElementById("reportMessage");
const printButton = document.getElementById("printReportButton");
const paymentFilter = document.getElementById("paymentFilter");
const inventoryCategoryFilter = document.getElementById("inventoryCategoryFilter");
const REPORT_TIME_ZONE = "Asia/Manila";
const CHART_COLORS = ["#173d72", "#2f6db3", "#5d97d2", "#94b8dd", "#16a34a", "#f59e0b", "#64748b", "#0f2046"];
const charts = {};

let currentSalesData = null;
let currentInventoryData = null;
let currentMovementData = null;
let currentReport = null;
const currency = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
});

function setMessage(message, isError = false) {
    reportMessage.textContent = message;
    reportMessage.classList.toggle("error-message", isError);
}

async function apiRequest(url) {
    const token = localStorage.getItem("token");
    const response = await fetch(apiUrl(url), {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem("token");
            window.location.replace("/");
        }
        throw new Error(data.message || "Request failed.");
    }
    return data;
}

function localDateValue(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: REPORT_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function updateDatepickerMaximum() {
    periodDate.max = localDateValue();
}

function updateReportControls() {
    updateDatepickerMaximum();
    const isSales = reportCategory.value === "sales";
    // Period/date always apply: sales views and stock movements use them.
    // The inventory snapshot is a current-stock view and ignores them.
    document.getElementById("paymentGroup").hidden = !isSales;
    document.getElementById("inventoryCategoryGroup").hidden = isSales;
    document.getElementById("periodDateLabel").textContent =
        salesPeriod.value === "weekly" ? "Any Date in Week" :
            salesPeriod.value === "monthly" ? "Any Date in Month" :
                salesPeriod.value === "yearly" ? "Any Date in Year" : "Date";
}

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value == null ? "" : String(value);
    row.append(cell);
    return cell;
}

// ---------- Stacked-page builders ----------

function clearResults() {
    for (const key of Object.keys(charts)) {
        try {
            charts[key].destroy();
        } catch (error) {
            console.error("Unable to clear chart:", error);
        }
        delete charts[key];
    }
    reportResults.replaceChildren();
    reportResults.hidden = true;
}

// One stacked view section: heading + Export button, summary cards, chart slot,
// then tables. Returns handles for the renderers below.
function makeViewSection(id, title, periodText, exportKey) {
    const section = document.createElement("section");
    section.className = "data-section report-view";
    section.id = id;
    const heading = document.createElement("div");
    heading.className = "report-heading";
    const titleWrap = document.createElement("div");
    const headingTitle = document.createElement("h2");
    headingTitle.textContent = title;
    const headingPeriod = document.createElement("p");
    headingPeriod.textContent = periodText;
    titleWrap.append(headingTitle, headingPeriod);
    const sideWrap = document.createElement("div");
    const generated = document.createElement("p");
    generated.textContent = `Generated ${new Date().toLocaleString()}`;
    sideWrap.append(generated);
    if (exportKey) {
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.className = "btn-export view-export-btn";
        exportButton.textContent = "Export CSV";
        exportButton.dataset.export = exportKey;
        sideWrap.append(exportButton);
    }
    heading.append(titleWrap, sideWrap);
    const summary = document.createElement("div");
    summary.className = "summary-section";
    summary.setAttribute("aria-label", `${title} summary`);
    const chartSlot = document.createElement("div");
    section.append(heading, summary, chartSlot);
    reportResults.append(section);
    return { section, summary, chartSlot };
}

function addViewSummary(summary, items) {
    summary.replaceChildren();
    for (const [label, value, isAlert] of items) {
        const card = document.createElement("article");
        card.className = "summary-card";
        const heading = document.createElement("h3");
        heading.textContent = label;
        const amount = document.createElement("p");
        amount.className = isAlert ? "value alert" : "value";
        amount.textContent = value;
        card.append(heading, amount);
        summary.append(card);
    }
}

function addViewTable(section, title, headers, rows, emptyMessage, sortTypes = [], sortValues = []) {
    const titleElement = document.createElement("h2");
    titleElement.textContent = title;
    titleElement.className = "view-table-title";
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    const table = document.createElement("table");
    table.className = "report-table";
    const tableHead = document.createElement("thead");
    const tableBody = document.createElement("tbody");
    table.append(tableHead, tableBody);
    wrapper.append(table);
    section.append(titleElement, wrapper);

    const headerRow = document.createElement("tr");
    for (const [index, header] of headers.entries()) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.dataset.sortType = sortTypes[index] || "text";
        cell.textContent = header;
        headerRow.append(cell);
    }
    tableHead.replaceChildren(headerRow);
    tableBody.replaceChildren();

    if (rows.length === 0) {
        const row = document.createElement("tr");
        const cell = addCell(row, emptyMessage);
        cell.colSpan = headers.length;
        tableBody.append(row);
        window.makeTableSortable(table);
        return;
    }

    for (const [rowIndex, values] of rows.entries()) {
        const row = document.createElement("tr");
        for (const [cellIndex, value] of values.entries()) {
            const cell = addCell(row, value);
            const sortValue = sortValues[rowIndex]?.[cellIndex];
            if (sortValue !== undefined && sortValue !== null) {
                cell.dataset.sortValue = String(sortValue);
            }
        }
        tableBody.append(row);
    }
    window.makeTableSortable(table);
}

// Charts are visual summaries only; tables stay the source of truth.
// Fails soft when the CDN library is blocked.
function addViewChart(chartSlot, title, type, labels, values, label) {
    if (!window.Chart || labels.length === 0) {
        return;
    }
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const canvas = document.createElement("canvas");
    wrap.append(heading, canvas);
    chartSlot.append(wrap);
    const backgroundColor = labels.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]);
    charts[`chart-${Object.keys(charts).length}`] = new window.Chart(canvas, {
        type,
        data: {
            labels,
            datasets: [{
                label: label || title,
                data: values,
                backgroundColor: type === "doughnut" ? backgroundColor : backgroundColor[0],
                borderWidth: 1,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            ...(type === "bar" && labels.length > 8 ? { indexAxis: "y" } : {}),
            plugins: { legend: { display: type === "doughnut" } },
        },
    });
}

function populateInventoryCategoryFilter(products) {
    const names = [...new Set(
        products.map((product) => product.categoryName || "Uncategorized")
    )].sort((left, right) => left.localeCompare(right));
    const previous = inventoryCategoryFilter.value;
    inventoryCategoryFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All categories";
    inventoryCategoryFilter.append(allOption);
    for (const name of names) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        inventoryCategoryFilter.append(option);
    }
    if (names.includes(previous)) {
        inventoryCategoryFilter.value = previous;
    }
}

function formatDate(value) {
    return new Date(value).toLocaleString();
}

function reportPeriodLabel(data) {
    const start = new Date(data.startDate);
    const end = new Date(new Date(data.endDateExclusive).getTime() - 1);
    const dateFormat = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: REPORT_TIME_ZONE
    });
    if (salesPeriod.value === "daily") {
        return dateFormat.format(start);
    }
    return `${dateFormat.format(start)} – ${dateFormat.format(end)}`;
}

function salesPeriodText(data) {
    return `${salesPeriod.options[salesPeriod.selectedIndex].text} • ${reportPeriodLabel(data)}`;
}

// ---------- Sales views (one enriched payload) ----------

function renderOverviewView(data) {
    const view = makeViewSection("view-overview", "Sales Overview", salesPeriodText(data), "overview");
    const summary = [
        ["Transactions", String(data.summary.salesCount)],
        ["Gross Sales", currency.format(data.summary.grossSales)],
        ["Discounts", currency.format(data.summary.discounts)],
        ["Net Sales", currency.format(data.summary.netSales)]
    ];
    for (const [method, total] of Object.entries(data.summary.paymentTotals)) {
        summary.push([`${method} Payments`, currency.format(total)]);
    }
    addViewSummary(view.summary, summary);
    const methods = Object.keys(data.summary.paymentTotals);
    if (methods.length > 0) {
        addViewChart(view.chartSlot, "Payments", "doughnut",
            methods, methods.map((method) => data.summary.paymentTotals[method]), "Net sales");
    }
    addViewTable(
        view.section,
        "Transactions and Items",
        ["Date", "Receipt", "Cashier", "Payment", "Gross", "Discount", "Net", "Items"],
        data.transactions.map((transaction) => {
            const items = transaction.items.length
                ? transaction.items.map((item) =>
                    `${item.productName} × ${item.quantity} (${currency.format(item.subtotal)})`
                ).join("\n")
                : "No item details";
            return [
                formatDate(transaction.date),
                transaction.receiptNumber || "—",
                transaction.cashier,
                transaction.paymentMethod,
                currency.format(transaction.subtotal),
                currency.format(transaction.discount),
                currency.format(transaction.totalAmount),
                items
            ];
        }),
        "No completed sales in this period.",
        ["date", "text", "text", "text", "number", "number", "number", "text"],
        data.transactions.map((transaction) => [transaction.date])
    );
    addViewTable(
        view.section,
        "Most Purchased Products (Top 10 by Units Sold)",
        ["Product", "Barcode", "Units Sold", "Sales Revenue"],
        data.mostPurchasedProducts.map((product) => [
            product.productName,
            product.barcode || "—",
            product.unitsSold,
            currency.format(product.revenue)
        ]),
        "No products were sold in this period.",
        ["text", "text", "number", "number"],
        data.mostPurchasedProducts.map((product) => [
            product.productName,
            product.barcode,
            product.unitsSold,
            product.revenue
        ])
    );
}

function renderTrendView(data) {
    const view = makeViewSection("view-trend", "Sales Trend", salesPeriodText(data), "trend");
    const buckets = data.trend?.buckets || [];
    const peak = buckets.reduce((best, bucket) =>
        bucket.netSales > (best?.netSales ?? -1) ? bucket : best, null);
    addViewSummary(view.summary, [
        ["Buckets", String(buckets.length)],
        ["Busiest", peak ? peak.label : "—"],
        ["Peak Sales", peak ? currency.format(peak.netSales) : currency.format(0)],
        ["Net Sales", currency.format(data.summary.netSales)]
    ]);
    if (buckets.length > 0) {
        addViewChart(view.chartSlot,
            data.trend.granularity === "hour" ? "Net Sales by Hour" : "Net Sales",
            "bar",
            buckets.map((bucket) => bucket.label),
            buckets.map((bucket) => bucket.netSales),
            "Net sales (₱)"
        );
    }
    addViewTable(
        view.section,
        "Trend Details",
        [data.trend?.granularity === "hour" ? "Hour" : "Period", "Transactions", "Net Sales"],
        buckets.map((bucket) => [bucket.label, bucket.transactions, currency.format(bucket.netSales)]),
        "No completed sales in this period.",
        ["text", "number", "number"],
        buckets.map((bucket) => [bucket.label, bucket.transactions, bucket.netSales])
    );
}

function renderCategoriesView(data) {
    const view = makeViewSection("view-categories", "Category Sales", salesPeriodText(data), "categories");
    const rows = data.categoryBreakdown || [];
    const totalUnits = rows.reduce((sum, row) => sum + row.unitsSold, 0);
    addViewSummary(view.summary, [
        ["Categories", String(rows.length)],
        ["Units Sold", String(totalUnits)],
        ["Revenue", currency.format(rows.reduce((sum, row) => sum + row.revenue, 0))]
    ]);
    if (rows.length > 0) {
        addViewChart(view.chartSlot, "Revenue by Category", "bar",
            rows.map((row) => row.categoryName),
            rows.map((row) => row.revenue), "Revenue (₱)");
    }
    addViewTable(
        view.section,
        "Category Details",
        ["Category", "Units Sold", "Revenue"],
        rows.map((row) => [row.categoryName, row.unitsSold, currency.format(row.revenue)]),
        "No products were sold in this period.",
        ["text", "number", "number"],
        rows.map((row) => [row.categoryName, row.unitsSold, row.revenue])
    );
}

function renderPaymentsView(data) {
    const view = makeViewSection("view-payments", "Payment Split", salesPeriodText(data), "payments");
    const rows = data.paymentBreakdown || [];
    addViewSummary(view.summary, [
        ["Methods", String(rows.length)],
        ["Transactions", String(data.summary.salesCount)],
        ["Net Sales", currency.format(data.summary.netSales)]
    ]);
    if (rows.length > 0) {
        addViewChart(view.chartSlot, "Sales by Payment Method", "doughnut",
            rows.map((row) => row.paymentMethod),
            rows.map((row) => row.totalSales), "Total sales (₱)");
    }
    addViewTable(
        view.section,
        "Payment Details",
        ["Method", "Transactions", "Total", "Avg Ticket"],
        rows.map((row) => [
            row.paymentMethod,
            row.transactions,
            currency.format(row.totalSales),
            currency.format(row.averageTicket)
        ]),
        "No completed sales in this period.",
        ["text", "number", "number", "number"],
        rows.map((row) => [
            row.paymentMethod,
            row.transactions,
            row.totalSales,
            row.averageTicket
        ])
    );
}

function renderDiscountsView(data) {
    const view = makeViewSection("view-discounts", "Discounts Audit", salesPeriodText(data), "discounts");
    const rows = data.discountedTransactions || [];
    addViewSummary(view.summary, [
        ["Discounted Sales", String(rows.length)],
        ["Discounts Given", currency.format(data.summary.discounts)],
        ["Net Sales", currency.format(data.summary.netSales)]
    ]);
    addViewTable(
        view.section,
        "Discounted Transactions",
        ["Date", "Receipt", "Cashier", "Payment", "Discount", "Net"],
        rows.map((transaction) => [
            formatDate(transaction.date),
            transaction.receiptNumber || "—",
            transaction.cashier,
            transaction.paymentMethod,
            currency.format(transaction.discount),
            currency.format(transaction.totalAmount)
        ]),
        "No discounted sales in this period.",
        ["date", "text", "text", "text", "number", "number"],
        rows.map((transaction) => [
            transaction.date,
            transaction.receiptNumber,
            transaction.cashier,
            transaction.paymentMethod,
            transaction.discount,
            transaction.totalAmount
        ])
    );
}

function renderSalesPage(data) {
    renderOverviewView(data);
    renderTrendView(data);
    renderCategoriesView(data);
    renderPaymentsView(data);
    renderDiscountsView(data);
}

// ---------- Inventory views ----------

function renderSnapshotView(data) {
    const view = makeViewSection("view-snapshot", "Inventory Snapshot", "Current stock snapshot", "snapshot");
    populateInventoryCategoryFilter(data.products);
    const selectedCategory = inventoryCategoryFilter.value;
    const shown = selectedCategory
        ? data.products.filter((product) => (product.categoryName || "Uncategorized") === selectedCategory)
        : data.products;
    const shownUnits = shown.reduce((sum, product) => sum + product.stockQuantity, 0);
    const shownValue = shown.reduce((sum, product) => sum + product.stockValue, 0);
    addViewSummary(view.summary, [
        ["Products", String(shown.length)],
        ["Units in Stock", String(shownUnits)],
        ["Total Stock Value", currency.format(shownValue)],
        [`Low Stock (${data.lowStockThreshold} or fewer)`, String(data.summary.lowStockCount), data.summary.lowStockCount > 0]
    ]);
    addViewTable(
        view.section,
        "Inventory Details",
        ["Barcode", "Product", "Category", "Quantity", "Unit Price", "Stock Value", "Status"],
        shown.map((product) => [
            product.barcode || "—",
            product.productName,
            product.categoryName,
            product.stockQuantity,
            currency.format(product.unitPrice),
            currency.format(product.stockValue),
            product.status
        ]),
        "No inventory products found.",
        ["text", "text", "text", "number", "number", "number", "text"],
        shown.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity,
            product.unitPrice,
            product.stockValue,
            product.status
        ])
    );
    addViewTable(
        view.section,
        `Low Stock (${data.lowStockThreshold} or Fewer Units; Active Products Only)`,
        ["Barcode", "Product", "Category", "Quantity"],
        data.lowStockProducts.map((product) => [
            product.barcode || "—",
            product.productName,
            product.categoryName,
            product.stockQuantity
        ]),
        "No active products are at or below the low-stock threshold.",
        ["text", "text", "text", "number"],
        data.lowStockProducts.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity
        ])
    );
}

function renderMovementsView(data) {
    const view = makeViewSection("view-movements", "Stock Movements", salesPeriodText(data), "movements");
    addViewSummary(view.summary, [
        ["Movements", String(data.summary.movementCount)],
        ["Units In", String(data.summary.unitsIn)],
        ["Units Out", String(data.summary.unitsOut)]
    ]);
    addViewTable(
        view.section,
        "Movement Details",
        ["Date", "Type", "Product", "Quantity", "Reason", "Recorded By"],
        data.movements.map((movement) => [
            formatDate(movement.date),
            movement.type,
            `${movement.productName}${movement.barcode ? ` (${movement.barcode})` : ""}`,
            movement.quantity,
            movement.reason,
            movement.user
        ]),
        "No stock movements in this period.",
        ["date", "text", "text", "number", "text", "text"],
        data.movements.map((movement) => [
            movement.date,
            movement.type,
            movement.productName,
            movement.quantity,
            movement.reason,
            movement.user
        ])
    );
}

function renderInventoryPage() {
    if (!currentInventoryData || !currentMovementData) {
        return;
    }
    renderSnapshotView(currentInventoryData);
    renderMovementsView(currentMovementData);
}

// ---------- Generate ----------

async function generateReport() {
    setMessage("");
    clearResults();
    currentSalesData = null;
    currentInventoryData = null;
    currentMovementData = null;
    currentReport = null;
    updateDatepickerMaximum();
    if (!periodDate.value || periodDate.value > periodDate.max) {
        setMessage("Choose a report date that is not in the future.", true);
        return;
    }
    const params = `period=${encodeURIComponent(salesPeriod.value)}&date=${encodeURIComponent(periodDate.value)}`;
    const isSales = reportCategory.value === "sales";
    const button = document.getElementById("generateReportButton");
    button.disabled = true;
    try {
        if (isSales) {
            let query = `/api/admin/reports/sales?${params}`;
            if (paymentFilter.value) {
                query += `&payment=${encodeURIComponent(paymentFilter.value)}`;
            }
            currentSalesData = await apiRequest(query);
            currentReport = currentSalesData;
            renderSalesPage(currentSalesData);
        } else {
            const [inventoryData, movementData] = await Promise.all([
                apiRequest("/api/admin/reports/inventory"),
                apiRequest(`/api/admin/reports/movements?${params}`)
            ]);
            currentInventoryData = inventoryData;
            currentMovementData = movementData;
            currentReport = inventoryData;
            renderInventoryPage();
        }
        reportResults.hidden = false;
        printButton.disabled = false;
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
}

// ---------- CSV export (one file per view) ----------

function escapeCsv(value) {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

function overviewCsvRows(data) {
    const headers = [
        "Date", "Receipt", "Cashier", "Payment Method", "Amount Paid",
        "Change", "Reference", "Gross Sales", "Discount", "Net Sales",
        "Product", "Barcode", "Quantity", "Unit Price", "Item Subtotal"
    ];
    const rows = [];
    for (const transaction of data.transactions) {
        const items = transaction.items.length ? transaction.items : [null];
        for (const item of items) {
            rows.push([
                transaction.date,
                transaction.receiptNumber,
                transaction.cashier,
                transaction.paymentMethod,
                transaction.amountPaid,
                transaction.changeAmount,
                transaction.referenceNumber,
                transaction.subtotal,
                transaction.discount,
                transaction.totalAmount,
                item?.productName || "",
                item?.barcode || "",
                item?.quantity ?? "",
                item?.unitPrice ?? "",
                item?.subtotal ?? ""
            ]);
        }
    }
    rows.push(
        [],
        ["Most Purchased Products (Top 10 by Units Sold)"],
        ["Product", "Barcode", "Units Sold", "Sales Revenue"],
        ...data.mostPurchasedProducts.map((product) => [
            product.productName,
            product.barcode,
            product.unitsSold,
            product.revenue
        ])
    );
    return [headers, ...rows];
}

function trendCsvRows(data) {
    return [
        ["Period", "Transactions", "Net Sales"],
        ...data.trend.buckets.map((bucket) => [
            bucket.label,
            bucket.transactions,
            bucket.netSales
        ])
    ];
}

function categoryCsvRows(data) {
    return [
        ["Category", "Units Sold", "Revenue"],
        ...data.categoryBreakdown.map((row) => [
            row.categoryName,
            row.unitsSold,
            row.revenue
        ])
    ];
}

function paymentCsvRows(data) {
    return [
        ["Method", "Transactions", "Total Sales", "Average Ticket"],
        ...data.paymentBreakdown.map((row) => [
            row.paymentMethod,
            row.transactions,
            row.totalSales,
            row.averageTicket
        ])
    ];
}

function discountCsvRows(data) {
    return [
        ["Date", "Receipt", "Cashier", "Payment Method", "Discount", "Net Sales"],
        ...data.discountedTransactions.map((transaction) => [
            transaction.date,
            transaction.receiptNumber,
            transaction.cashier,
            transaction.paymentMethod,
            transaction.discount,
            transaction.totalAmount
        ])
    ];
}

function snapshotCsvRows(data) {
    const selectedCategory = inventoryCategoryFilter.value;
    const shown = selectedCategory
        ? data.products.filter((product) => (product.categoryName || "Uncategorized") === selectedCategory)
        : data.products;
    return [
        ["Barcode", "Product", "Category", "Quantity", "Unit Price", "Stock Value", "Status"],
        ...shown.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity,
            product.unitPrice,
            product.stockValue,
            product.status
        ]),
        [],
        [`Low Stock (${data.lowStockThreshold} or Fewer Units; Active Products Only)`],
        ["Barcode", "Product", "Category", "Quantity"],
        ...data.lowStockProducts.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity
        ])
    ];
}

function movementCsvRows(data) {
    return [
        ["Date", "Type", "Product", "Barcode", "Quantity", "Reason", "Recorded By"],
        ...data.movements.map((movement) => [
            movement.date,
            movement.type,
            movement.productName,
            movement.barcode,
            movement.quantity,
            movement.reason,
            movement.user
        ])
    ];
}

const EXPORT_VIEWS = {
    overview: { rows: overviewCsvRows, data: () => currentSalesData, file: "sales-overview" },
    trend: { rows: trendCsvRows, data: () => currentSalesData, file: "sales-trend" },
    categories: { rows: categoryCsvRows, data: () => currentSalesData, file: "category-sales" },
    payments: { rows: paymentCsvRows, data: () => currentSalesData, file: "payment-split" },
    discounts: { rows: discountCsvRows, data: () => currentSalesData, file: "discounts-audit" },
    snapshot: { rows: snapshotCsvRows, data: () => currentInventoryData, file: "inventory-snapshot" },
    movements: { rows: movementCsvRows, data: () => currentMovementData, file: "stock-movements" },
};

function downloadCsv(rows, filename) {
    const content = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}-${localDateValue()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function exportView(key) {
    const view = EXPORT_VIEWS[key];
    const data = view?.data();
    if (!view || !data) {
        return;
    }
    downloadCsv(view.rows(data), view.file);
}

function printReport() {
    if (!currentReport) {
        return;
    }
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
        setMessage("Allow pop-ups to print the report.", true);
        return;
    }
    printWindow.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${reportCategory.options[reportCategory.selectedIndex].text}</title>
<style>
body{font-family:Arial,sans-serif;color:#1f2937;padding:24px}h1,h2{color:#173d72}
.summary-section{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.summary-card{border:1px solid #ddd;padding:12px 16px;min-width:150px}
.summary-card h3{font-size:12px;text-transform:uppercase;color:#64748b}
.summary-card .value{font-size:20px;font-weight:bold}
.table-wrapper{overflow:visible}.report-table{width:100%;border-collapse:collapse}
.report-table th,.report-table td{border:1px solid #ddd;padding:7px;text-align:left;white-space:pre-line}
.report-heading{display:flex;justify-content:space-between;align-items:flex-start}
.view-export-btn{display:none}
@media print{body{padding:0}.report-table{font-size:10px}}
</style></head><body></body></html>`);
    const printableResults = printWindow.document.importNode(reportResults, true);
    printableResults.hidden = false;
    printWindow.document.body.append(printableResults);
    printWindow.document.close();
    printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
    };
}

reportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    generateReport();
});
reportCategory.addEventListener("change", updateReportControls);
salesPeriod.addEventListener("change", updateReportControls);
inventoryCategoryFilter.addEventListener("change", () => {
    // Category narrows the cached snapshot without refetching.
    if (reportCategory.value === "inventory" && currentInventoryData && currentMovementData) {
        clearResults();
        renderInventoryPage();
        reportResults.hidden = false;
    }
});
reportResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (button) {
        exportView(button.dataset.export);
    }
});
printButton.addEventListener("click", printReport);
document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

async function authorizeReports() {
    if (!localStorage.getItem("token")) {
        window.location.replace("/");
        return;
    }
    try {
        const { user } = await apiRequest("/api/profile");
        if (user.role !== "Admin") {
            window.location.replace("dashboard.html");
            return;
        }
        document.getElementById("userInfo").textContent =
            `${user.fullName} (@${user.username})`;
        // Default view: today's full sales report, so the page is useful
        // before Generate is ever pressed.
        reportCategory.value = "sales";
        salesPeriod.value = "daily";
        periodDate.value = localDateValue();
        updateReportControls();
        reportsPage.hidden = false;
        await generateReport();
    } catch (error) {
        setMessage(error.message, true);
        console.error("Unable to authorize reports page:", error);
    }
}

authorizeReports();
