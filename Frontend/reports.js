

const apiUrl = window.apiUrl || ((path) => path);
const reportsPage = document.getElementById("reportsPage");
const reportForm = document.getElementById("reportForm");
const reportCategory = document.getElementById("reportCategory");
const salesPeriod = document.getElementById("salesPeriod");
const periodDate = document.getElementById("periodDate");
const periodYear = document.getElementById("periodYear");
const periodDateLabel = document.getElementById("periodDateLabel");
const reportResults = document.getElementById("reportResults");
const reportMessage = document.getElementById("reportMessage");
const printButton = document.getElementById("printReportButton");
const paymentFilter = document.getElementById("paymentFilter");
const inventoryCategoryFilter = document.getElementById("inventoryCategoryFilter");
const REPORT_TIME_ZONE = "Asia/Manila";
const EARLIEST_REPORT_DATE = "2022-01-01";
// First Sunday on or after 2022-01-01; weeks starting in 2021 stay unavailable.
const EARLIEST_REPORT_WEEK = "2022-01-02";
const REPORT_PERIOD_LABELS = {
    daily: "Choose any specific day",
    weekly: "Choose any week in a month",
    monthly: "Choose any month in a year",
    yearly: "Choose any specific year",
};
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

// Writes the page status line, optionally as an error.
function setMessage(message, isError = false) {
    setStatusMessage(reportMessage, message, isError);
}

// Returns today's date string in the report time zone.
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

// Parses YYYY-MM-DD into a UTC date, or null when malformed.
function parseCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

// Formats a UTC date back to a YYYY-MM-DD string.
function formatCalendarDate(date) {
    const year = String(date.getUTCFullYear()).padStart(4, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Snaps a date back to the Sunday that starts its week.
function sundayOf(value) {
    const date = parseCalendarDate(value);
    if (!date) {
        return null;
    }
    const daysSinceSunday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - daysSinceSunday);
    return formatCalendarDate(date);
}

// Keeps a date inside the selectable range.
function clampAnchor(value) {
    const today = localDateValue();
    if (!value || value < EARLIEST_REPORT_DATE) {
        return EARLIEST_REPORT_DATE;
    }
    return value > today ? today : value;
}

// Tracks the last valid anchor so switching periods keeps a sensible date.
let lastSelectedDate = clampAnchor(localDateValue());

// Returns the YYYY-MM-DD anchor the API expects for the active period.
function reportDateValue() {
    const period = salesPeriod.value;
    if (period === "yearly") {
        return periodYear.value ? `${periodYear.value}-01-01` : "";
    }
    if (!periodDate.value) {
        return "";
    }
    if (period === "monthly") {
        return /^\d{4}-\d{2}$/.test(periodDate.value) ? `${periodDate.value}-01` : "";
    }
    if (period === "weekly") {
        return sundayOf(periodDate.value) || "";
    }
    return periodDate.value;
}

// Populates the year dropdown from 2022 through the current year.
function syncYearOptions() {
    const years = yearsWithinRange();
    const previous = periodYear.value;
    periodYear.replaceChildren(...years.map((year) => {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        return option;
    }));
    const previousYear = Number(previous);
    periodYear.value = years.includes(previousYear) ? previous : String(years[0]);
}

// Applies the tracked anchor to the control that the active period uses.
function applyAnchorToPicker() {
    const period = salesPeriod.value;
    const anchor = clampAnchor(lastSelectedDate);
    if (period === "yearly") {
        const year = Number(anchor.slice(0, 4));
        periodYear.value = yearsWithinRange().includes(year) ? String(year) : "";
        return;
    }
    if (period === "monthly") {
        periodDate.value = anchor.slice(0, 7);
        return;
    }
    if (period === "weekly") {
        const sunday = sundayOf(anchor) || anchor;
        periodDate.value = sunday < EARLIEST_REPORT_WEEK ? EARLIEST_REPORT_WEEK : sunday;
        return;
    }
    periodDate.value = anchor;
}

// Returns the selectable years as numbers.
function yearsWithinRange() {
    const currentYear = Number(localDateValue().slice(0, 4));
    const firstYear = Number(EARLIEST_REPORT_DATE.slice(0, 4));
    return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index);
}

// Refreshes the upper bound so an overnight session cannot submit a future date.
function refreshPickerMaximum() {
    const today = localDateValue();
    if (salesPeriod.value === "monthly") {
        periodDate.max = today.slice(0, 7);
    } else if (salesPeriod.value !== "yearly") {
        periodDate.max = today;
    }
}

// Configures the date picker bounds and type for the active period.
function updateDatepickerBounds() {
    const period = salesPeriod.value;
    const useYearSelect = period === "yearly";

    periodDate.hidden = useYearSelect;
    periodYear.hidden = !useYearSelect;
    periodDateLabel.htmlFor = useYearSelect ? "periodYear" : "periodDate";
    periodDate.required = !useYearSelect;
    periodYear.required = useYearSelect;

    if (useYearSelect) {
        syncYearOptions();
        applyAnchorToPicker();
        return;
    }

    if (period === "monthly") {
        if (periodDate.type !== "month") {
            periodDate.type = "month";
        }
        periodDate.removeAttribute("step");
        periodDate.min = EARLIEST_REPORT_DATE.slice(0, 7);
    } else {
        if (periodDate.type !== "date") {
            periodDate.type = "date";
        }
        if (period === "weekly") {
            periodDate.min = EARLIEST_REPORT_WEEK;
            periodDate.step = "7";
        } else {
            periodDate.min = EARLIEST_REPORT_DATE;
            periodDate.removeAttribute("step");
        }
    }

    refreshPickerMaximum();
    applyAnchorToPicker();
}

// Shows or hides filters based on the report category.
function updateReportControls() {
    const active = reportDateValue();
    if (active) {
        lastSelectedDate = clampAnchor(active);
    }
    updateDatepickerBounds();
    const isSales = reportCategory.value === "sales";
    
    
    document.getElementById("paymentGroup").hidden = !isSales;
    document.getElementById("inventoryCategoryGroup").hidden = isSales;
    periodDateLabel.textContent = REPORT_PERIOD_LABELS[salesPeriod.value] || REPORT_PERIOD_LABELS.daily;
}





// Tells the sidebar helper that sections were added.
function notifySectionsChanged() {
    window.dispatchEvent(new CustomEvent("page-sections-changed"));
}





const REPORT_VIEW_IDS = {
    sales: ["view-overview", "view-trend", "view-categories", "view-payments", "view-discounts"],
    inventory: ["view-snapshot", "view-movements"],
};

// Shows sidebar links for the active category's views.
function syncReportSidebar() {
    
    
    notifySectionsChanged();
    const available = new Set(
        (REPORT_VIEW_IDS[reportCategory.value] || []).filter((id) => document.getElementById(id))
    );
    for (const link of document.querySelectorAll(".page-sidebar a[href^='#']")) {
        const id = link.getAttribute("href").slice(1);
        if (id === "reportFilterSection") {
            link.hidden = false;
            continue;
        }
        link.hidden = !available.has(id);
    }
}

// Destroys charts and empties the results area.
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



// Builds one stacked view section and returns its handles.
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

// Fills a view section with summary cards.
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

// Adds a titled, sortable table to a view section.
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
            const cell = value instanceof Node ? document.createElement("td") : addCell(row, value);
            if (value instanceof Node) {
                cell.append(value);
                row.append(cell);
            }
            const sortValue = sortValues[rowIndex]?.[cellIndex];
            if (sortValue !== undefined && sortValue !== null) {
                cell.dataset.sortValue = String(sortValue);
            }
        }
        tableBody.append(row);
    }
    window.makeTableSortable(table);
}

// Builds a clickable receipt number for report tables.
function makeReceiptLink(transaction) {
    if (!transaction.receiptNumber) {
        return "—";
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "receipt-link";
    button.dataset.receipt = transaction.receiptNumber;
    button.textContent = transaction.receiptNumber;
    button.title = "View and print receipt";
    button.setAttribute("aria-label", `View and print receipt ${transaction.receiptNumber}`);
    return button;
}



// Renders a chart into a view section when the library loaded.
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

// Rebuilds the inventory category dropdown, keeping the selection.
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

// Formats a timestamp for report tables.
function formatDate(value) {
    return new Date(value).toLocaleString();
}

// Builds the human-readable period range label.
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

// Combines the period name with its date range.
function salesPeriodText(data) {
    return `${salesPeriod.options[salesPeriod.selectedIndex].text} • ${reportPeriodLabel(data)}`;
}



// Renders the sales summary, transactions, and top products.
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
                makeReceiptLink(transaction),
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

// Renders the sales trend chart and table.
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

// Renders revenue grouped by product category.
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

// Renders the sales split by payment method.
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

// Renders every discounted transaction in the period.
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
            makeReceiptLink(transaction),
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

// Renders all sales views from one payload.
function renderSalesPage(data) {
    renderOverviewView(data);
    renderTrendView(data);
    renderCategoriesView(data);
    renderPaymentsView(data);
    renderDiscountsView(data);
}



// Renders the current inventory snapshot and low stock.
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

// Renders stock movements for the chosen period.
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

// Renders both inventory views from cached payloads.
function renderInventoryPage() {
    if (!currentInventoryData || !currentMovementData) {
        return;
    }
    renderSnapshotView(currentInventoryData);
    renderMovementsView(currentMovementData);
}





// Shows a placeholder while a report request is in flight.
function showLoadingState(label) {
    const wrapper = document.createElement("div");
    wrapper.className = "report-loading";
    wrapper.setAttribute("role", "status");
    const spinner = document.createElement("span");
    spinner.className = "report-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("p");
    text.textContent = label;
    wrapper.append(spinner, text);
    reportResults.replaceChildren(wrapper);
    reportResults.hidden = false;
    
    printButton.disabled = true;
}



// Fetches the active report category and renders it.
async function generateReport() {
    setMessage("");
    refreshPickerMaximum();
    const reportDate = reportDateValue();
    if (!reportDate) {
        setMessage("Choose a report date.", true);
        return;
    }
    if (reportDate < EARLIEST_REPORT_DATE) {
        setMessage("Choose a report date on or after January 1, 2022.", true);
        return;
    }
    if (reportDate > localDateValue()) {
        setMessage("Choose a report date that is not in the future.", true);
        return;
    }
    lastSelectedDate = reportDate;
    const params = `period=${encodeURIComponent(salesPeriod.value)}&date=${encodeURIComponent(reportDate)}`;
    const isSales = reportCategory.value === "sales";
    
    
    const periodLabel = salesPeriod.options[salesPeriod.selectedIndex].text.toLowerCase();
    const button = document.getElementById("generateReportButton");
    button.disabled = true;
    button.textContent = "Generating...";
    showLoadingState(isSales
        ? `Loading ${periodLabel} sales report...`
        : "Loading inventory and stock movements...");
    try {
        
        
        
        let salesData = null;
        let inventoryData = null;
        let movementData = null;
        if (isSales) {
            let query = `/api/admin/reports/sales?${params}`;
            if (paymentFilter.value) {
                query += `&payment=${encodeURIComponent(paymentFilter.value)}`;
            }
            salesData = await apiRequest(query);
        } else {
            [inventoryData, movementData] = await Promise.all([
                apiRequest("/api/admin/reports/inventory"),
                apiRequest(`/api/admin/reports/movements?${params}`)
            ]);
        }

        clearResults();
        currentSalesData = salesData;
        currentInventoryData = inventoryData;
        currentMovementData = movementData;
        currentReport = isSales ? salesData : inventoryData;
        if (isSales) {
            renderSalesPage(salesData);
        } else {
            renderInventoryPage();
        }
        reportResults.hidden = false;
        printButton.disabled = false;
        syncReportSidebar();
    } catch (error) {
        
        
        clearResults();
        setMessage(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "Generate Report";
    }
}



// Escapes a value for safe CSV output.
function escapeCsv(value) {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

// Builds sales overview CSV rows.
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

// Builds sales trend CSV rows.
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

// Builds category sales CSV rows.
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

// Builds payment split CSV rows.
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

// Builds discounts audit CSV rows.
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

// Builds inventory snapshot CSV rows.
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

// Builds stock movement CSV rows.
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

// Downloads rows as a CSV file.
function downloadCsv(rows, filename) {
    const content = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}-${localDateValue()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Exports one rendered view as CSV.
function exportView(key) {
    const view = EXPORT_VIEWS[key];
    const data = view?.data();
    if (!view || !data) {
        return;
    }
    downloadCsv(view.rows(data), view.file);
}

// Finds the full transaction behind a receipt number in the current report.
function findTransactionByReceipt(receiptNumber) {
    return (currentSalesData?.transactions || []).find(
        (transaction) => transaction.receiptNumber === receiptNumber
    ) || null;
}

// Populates the receipt dialog from report data and opens it.
function openReceipt(receiptNumber) {
    const transaction = findTransactionByReceipt(receiptNumber);
    if (!transaction) {
        setMessage("Unable to find that receipt in the current report.", true);
        return;
    }
    const setText = (id, value) => {
        document.getElementById(id).textContent = value;
    };
    const itemList = document.getElementById("receiptItemList");
    itemList.replaceChildren();
    if (!transaction.items?.length) {
        const row = document.createElement("tr");
        const cell = addCell(row, "No item details");
        cell.colSpan = 4;
        itemList.append(row);
    } else {
        for (const item of transaction.items) {
            const row = document.createElement("tr");
            addCell(row, item.productName);
            addCell(row, String(item.quantity));
            addCell(row, currency.format(item.unitPrice));
            addCell(row, currency.format(item.subtotal));
            itemList.append(row);
        }
    }
    setText("receiptNumber", transaction.receiptNumber);
    setText("receiptDate", new Date(transaction.date).toLocaleString());
    setText("receiptCashier", transaction.cashierId || "—");
    setText("receiptSubtotal", currency.format(transaction.subtotal));
    setText("receiptDiscount", currency.format(transaction.discount));
    setText("receiptTotal", currency.format(transaction.totalAmount));
    setText(
        "receiptPayment",
        transaction.paymentMethod === "Cash"
            ? `Cash received: ${currency.format(transaction.amountPaid)}`
            : `GCash: ${currency.format(transaction.amountPaid)}`
    );
    setText("receiptChange", currency.format(transaction.changeAmount));
    document.getElementById("receiptReferenceRow").hidden = !transaction.referenceNumber;
    setText("receiptReference", transaction.referenceNumber || "");
    document.body.classList.add("receipt-open");
    const dialog = document.getElementById("receiptDialog");
    if (!dialog.open) {
        dialog.showModal();
    }
}

// Opens a print window containing the current results.
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
.receipt-link{padding:0;border:0;background:none;color:inherit;font:inherit;text-decoration:none}
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
reportCategory.addEventListener("change", () => {
    updateReportControls();
    
    syncReportSidebar();
});
salesPeriod.addEventListener("change", updateReportControls);
inventoryCategoryFilter.addEventListener("change", () => {
    
    if (reportCategory.value === "inventory" && currentInventoryData && currentMovementData) {
        clearResults();
        renderInventoryPage();
        reportResults.hidden = false;
        syncReportSidebar();
    }
});
reportResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (button) {
        exportView(button.dataset.export);
        return;
    }
    const receiptLink = event.target.closest("[data-receipt]");
    if (receiptLink) {
        openReceipt(receiptLink.dataset.receipt);
    }
});
printButton.addEventListener("click", printReport);
document.getElementById("printReceiptButton").addEventListener("click", () => {
    window.print();
});
document.getElementById("closeReceiptButton").addEventListener("click", () => {
    document.getElementById("receiptDialog").close();
});
document.getElementById("receiptDialog").addEventListener("close", () => {
    document.body.classList.remove("receipt-open");
});
document.getElementById("logoutButton").addEventListener("click", () => {
    logout({ clearReportCache: true });
});



const CACHE_MAX_AGE_MS = 5 * 60 * 1000;

// Returns the preloaded sales payload when still fresh.
function readCachedSales() {
    return window.PossiaReportCache?.read("sales", CACHE_MAX_AGE_MS) || null;
}

// Renders a sales payload into the results area.
function showSalesData(data) {
    currentSalesData = data;
    currentReport = data;
    clearResults();
    renderSalesPage(data);
    reportResults.hidden = false;
    printButton.disabled = false;
    syncReportSidebar();
}



// Refetches sales so the shown numbers stay exact.
async function refreshSalesInBackground() {
    try {
        const query = `/api/admin/reports/sales?period=${encodeURIComponent(salesPeriod.value)}` +
            `&date=${encodeURIComponent(reportDateValue())}`;
        const data = await apiRequest(query);
        window.PossiaReportCache?.save("sales", data);
        showSalesData(data);
    } catch (error) {
        console.error("Unable to refresh today's sales report:", error);
    }
}

// Verifies Admin access, then renders the default report.
async function authorizeReports() {
    if (!localStorage.getItem("token")) {
        redirectToLogin();
        return;
    }
    try {
        const { user } = await apiRequest("/api/profile");
        if (user.role !== "Admin") {
            redirectToDashboard();
            return;
        }
        document.getElementById("userInfo").textContent = user.fullName;
        
        
        reportCategory.value = "sales";
        salesPeriod.value = "daily";
        lastSelectedDate = clampAnchor(localDateValue());
        updateReportControls();
        reportsPage.hidden = false;

        
        const cached = readCachedSales();
        if (cached) {
            showSalesData(cached);
            refreshSalesInBackground();
            return;
        }
        await generateReport();
    } catch (error) {
        setMessage(error.message, true);
        console.error("Unable to authorize reports page:", error);
    }
}

authorizeReports();
