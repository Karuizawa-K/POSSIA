const reportsPage = document.getElementById("reportsPage");
const reportForm = document.getElementById("reportForm");
const reportType = document.getElementById("reportType");
const salesPeriod = document.getElementById("salesPeriod");
const periodDate = document.getElementById("periodDate");
const reportResults = document.getElementById("reportResults");
const summaryCards = document.getElementById("summaryCards");
const reportTableHead = document.getElementById("reportTableHead");
const reportTableBody = document.getElementById("reportTableBody");
const reportMessage = document.getElementById("reportMessage");
const exportButton = document.getElementById("exportReportButton");
const printButton = document.getElementById("printReportButton");

let currentReport = null;
let currentReportType = null;
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
    const response = await fetch(url, {
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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function updateReportControls() {
    const isSales = reportType.value === "sales";
    document.getElementById("periodGroup").hidden = !isSales;
    document.getElementById("dateGroup").hidden = !isSales;
    periodDate.required = isSales;
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

function renderSummary(items) {
    summaryCards.replaceChildren();
    for (const [label, value, isAlert] of items) {
        const card = document.createElement("article");
        card.className = "summary-card";
        const heading = document.createElement("h3");
        heading.textContent = label;
        const amount = document.createElement("p");
        amount.className = isAlert ? "value alert" : "value";
        amount.textContent = value;
        card.append(heading, amount);
        summaryCards.append(card);
    }
}

function renderTable(headers, rows, emptyMessage, sortTypes = [], sortValues = []) {
    const headerRow = document.createElement("tr");
    for (const [index, header] of headers.entries()) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.dataset.sortType = sortTypes[index] || "text";
        cell.textContent = header;
        headerRow.append(cell);
    }
    reportTableHead.replaceChildren(headerRow);
    reportTableBody.replaceChildren();

    if (rows.length === 0) {
        const row = document.createElement("tr");
        const cell = addCell(row, emptyMessage);
        cell.colSpan = headers.length;
        reportTableBody.append(row);
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
        reportTableBody.append(row);
    }
    window.makeTableSortable(reportTableBody.closest("table"));
}

function formatDate(value) {
    return new Date(value).toLocaleString();
}

function reportPeriodLabel(data) {
    const start = new Date(data.startDate);
    const end = new Date(new Date(data.endDateExclusive).getTime() - 1);
    const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
    if (salesPeriod.value === "daily") {
        return dateFormat.format(start);
    }
    return `${dateFormat.format(start)} – ${dateFormat.format(end)}`;
}

function renderSalesReport(data) {
    document.getElementById("resultsTitle").textContent = "Sales Report";
    document.getElementById("resultsPeriod").textContent =
        `${salesPeriod.options[salesPeriod.selectedIndex].text} • ${reportPeriodLabel(data)}`;
    document.getElementById("generatedAt").textContent = `Generated ${new Date().toLocaleString()}`;

    const summary = [
        ["Transactions", String(data.summary.salesCount)],
        ["Gross Sales", currency.format(data.summary.grossSales)],
        ["Discounts", currency.format(data.summary.discounts)],
        ["Net Sales", currency.format(data.summary.netSales)]
    ];
    for (const [method, total] of Object.entries(data.summary.paymentTotals)) {
        summary.push([`${method} Payments`, currency.format(total)]);
    }
    renderSummary(summary);

    const rows = data.transactions.map((transaction) => {
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
    });
    document.getElementById("tableTitle").textContent = "Transactions and Items";
    renderTable(
        ["Date", "Receipt", "Cashier", "Payment", "Gross", "Discount", "Net", "Items"],
        rows,
        "No completed sales in this period.",
        ["date", "text", "text", "text", "number", "number", "number", "text"],
        data.transactions.map((transaction) => [transaction.date])
    );
}

function renderInventoryReport(data) {
    document.getElementById("resultsTitle").textContent = "Inventory Report";
    document.getElementById("resultsPeriod").textContent = "Current stock snapshot";
    document.getElementById("generatedAt").textContent =
        `As of ${new Date(data.generatedAt).toLocaleString()}`;
    renderSummary([
        ["Products", String(data.summary.productCount)],
        ["Units in Stock", String(data.summary.totalUnits)],
        ["Total Stock Value", currency.format(data.summary.totalValue)]
    ]);
    document.getElementById("tableTitle").textContent = "Inventory Details";
    renderTable(
        ["Barcode", "Product", "Category", "Quantity", "Unit Price", "Stock Value", "Status"],
        data.products.map((product) => [
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
        data.products.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity,
            product.unitPrice,
            product.stockValue,
            product.status
        ])
    );
}

async function generateReport() {
    setMessage("");
    const query = reportType.value === "sales"
        ? `/api/admin/reports/sales?period=${encodeURIComponent(salesPeriod.value)}&date=${encodeURIComponent(periodDate.value)}`
        : "/api/admin/reports/inventory";
    const button = document.getElementById("generateReportButton");
    button.disabled = true;
    try {
        const data = await apiRequest(query);
        currentReport = data;
        currentReportType = reportType.value;
        if (currentReportType === "sales") {
            renderSalesReport(data);
        } else {
            renderInventoryReport(data);
        }
        reportResults.hidden = false;
        exportButton.disabled = false;
        printButton.disabled = false;
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
}

function escapeCsv(value) {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

function salesCsvRows() {
    const headers = [
        "Date", "Receipt", "Cashier", "Payment Method", "Amount Paid",
        "Change", "Reference", "Gross Sales", "Discount", "Net Sales",
        "Product", "Barcode", "Quantity", "Unit Price", "Item Subtotal"
    ];
    const rows = [];
    for (const transaction of currentReport.transactions) {
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
    return [headers, ...rows];
}

function inventoryCsvRows() {
    return [
        ["Barcode", "Product", "Category", "Quantity", "Unit Price", "Stock Value", "Status"],
        ...currentReport.products.map((product) => [
            product.barcode,
            product.productName,
            product.categoryName,
            product.stockQuantity,
            product.unitPrice,
            product.stockValue,
            product.status
        ])
    ];
}

function exportCsv() {
    if (!currentReport) {
        return;
    }
    const rows = currentReportType === "sales" ? salesCsvRows() : inventoryCsvRows();
    const content = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentReportType}-report-${localDateValue()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
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
<title>${currentReportType === "sales" ? "Sales" : "Inventory"} Report</title>
<style>
body{font-family:Arial,sans-serif;color:#1f2937;padding:24px}h1,h2{color:#173d72}
.summary-section{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.summary-card{border:1px solid #ddd;padding:12px 16px;min-width:150px}
.summary-card h3{font-size:12px;text-transform:uppercase;color:#64748b}
.summary-card .value{font-size:20px;font-weight:bold}
.table-wrapper{overflow:visible}.report-table{width:100%;border-collapse:collapse}
.report-table th,.report-table td{border:1px solid #ddd;padding:7px;text-align:left;white-space:pre-line}
.report-heading{display:flex;justify-content:space-between;align-items:flex-start}
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
reportType.addEventListener("change", updateReportControls);
salesPeriod.addEventListener("change", updateReportControls);
exportButton.addEventListener("click", exportCsv);
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
        periodDate.value = localDateValue();
        updateReportControls();
        reportsPage.hidden = false;
    } catch (error) {
        setMessage(error.message, true);
        console.error("Unable to authorize reports page:", error);
    }
}

authorizeReports();
