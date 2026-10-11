const inventoryPage = document.getElementById("inventoryPage");
const inventoryRows = document.getElementById("inventoryRows");
const movementRows = document.getElementById("movementRows");
const categoryRows = document.getElementById("categoryRows");
const productForm = document.getElementById("productForm");
const productEditor = document.getElementById("productEditor");
const categoryForm = document.getElementById("categoryForm");
const statusMessage = document.getElementById("statusMessage");
const categoryFilter = document.getElementById("categoryFilter");
const categorySelect = document.getElementById("categoryId");
const barcodeInput = document.getElementById("barcode");
const productNameInput = document.getElementById("productName");
const barcodePreviewSection = document.getElementById("barcodePreviewSection");
const barcodePreviewSvg = document.getElementById("barcodePreview");
const barcodePreviewName = document.getElementById("barcodePreviewName");
const generateBarcodeButton = document.getElementById("generateBarcodeButton");
const printBarcodeButton = document.getElementById("printBarcodeButton");
const inventoryBarcodeDialog = document.getElementById("inventoryBarcodeDialog");
const inventoryBarcodePreview = document.getElementById("inventoryBarcodePreview");
const inventoryBarcodeTitle = document.getElementById("inventoryBarcodeTitle");
const inventoryBarcodeValue = document.getElementById("inventoryBarcodeValue");
const showProductFormButton = document.getElementById("showProductFormButton");

let currentRole = null;
let products = [];
let categories = [];
let editingProductId = null;
let dialogBarcodeProductName = "";

function showMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error-message", isError);
}

async function apiRequest(url, options = {}) {
    const token = localStorage.getItem("token");
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
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

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
    return cell;
}

function appendEmptyRow(target, colspan, message) {
    const row = document.createElement("tr");
    const cell = addCell(row, message);
    cell.colSpan = colspan;
    target.replaceChildren(row);
}

function visibleProducts() {
    const query = document.getElementById("inventorySearch").value.trim().toLowerCase();
    const selectedCategory = categoryFilter.value;
    const selectedStockStatus = document.getElementById("stockStatusFilter").value;
    const selectedStatus = currentRole === "Admin"
        ? document.getElementById("statusFilter").value
        : "active";

    return products.filter((product) => {
        const matchesSearch = !query ||
            product.productName.toLowerCase().includes(query) ||
            (product.barcode || "").toLowerCase().includes(query);
        const matchesCategory = !selectedCategory || product.categoryId === selectedCategory;
        const matchesStockStatus = selectedStockStatus === "all" ||
            (selectedStockStatus === "in-stock" && product.stockQuantity > 0) ||
            (selectedStockStatus === "out-of-stock" && product.stockQuantity === 0);
        const matchesStatus = selectedStatus === "all" ||
            (selectedStatus === "active" && product.isActive) ||
            (selectedStatus === "archived" && !product.isActive);
        return matchesSearch && matchesCategory && matchesStockStatus && matchesStatus;
    });
}

function renderInventory() {
    const shownProducts = visibleProducts();
    const admin = currentRole === "Admin";
    if (shownProducts.length === 0) {
        appendEmptyRow(inventoryRows, admin ? 7 : 6, "No products match your search.");
        return;
    }

    inventoryRows.replaceChildren();
    for (const product of shownProducts) {
        const row = document.createElement("tr");
        const barcodeCell = addCell(row, product.barcode || "—");
        if (product.barcode) {
            const barcodeButton = document.createElement("button");
            barcodeButton.type = "button";
            barcodeButton.className = "barcode-row-button";
            barcodeButton.textContent = "View / Print";
            barcodeButton.setAttribute("aria-label", `View or print barcode for ${product.productName}`);
            barcodeButton.addEventListener("click", () => showInventoryBarcode(product));
            barcodeCell.append(barcodeButton);
        }
        addCell(row, product.productName);
        addCell(row, product.categoryName);
        addCell(row, `₱${Number(product.unitPrice).toFixed(2)}`);
        const stockCell = addCell(row, product.stockQuantity === 0
            ? "0 (Out of stock)"
            : String(product.stockQuantity));
        if (product.stockQuantity === 0) {
            stockCell.className = "out-of-stock";
        }
        addCell(row, product.isActive ? "Active" : "Archived");

        if (admin) {
            const actions = document.createElement("td");
            actions.className = "admin-actions";
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "btn-secondary";
            editButton.textContent = "Edit";
            editButton.addEventListener("click", () => startEditing(product));
            actions.append(editButton);

            const statusButton = document.createElement("button");
            statusButton.type = "button";
            statusButton.className = product.isActive ? "btn-stockout" : "btn-stockin";
            statusButton.textContent = product.isActive ? "Archive" : "Reactivate";
            statusButton.addEventListener("click", () => updateProductStatus(product));
            actions.append(statusButton);

            if (product.isActive) {
                const adjustment = document.createElement("div");
                adjustment.className = "stock-adjustment";
                const quantity = document.createElement("input");
                quantity.type = "number";
                quantity.min = "1";
                quantity.step = "1";
                quantity.placeholder = "Qty";
                quantity.setAttribute("aria-label", `Quantity to adjust for ${product.productName}`);
                const reason = document.createElement("input");
                reason.type = "text";
                reason.maxLength = 250;
                reason.placeholder = "Reason (required for stock out)";
                reason.setAttribute("aria-label", `Reason for stock adjustment to ${product.productName}`);
                const stockInButton = document.createElement("button");
                stockInButton.type = "button";
                stockInButton.className = "btn-stockin";
                stockInButton.textContent = "Stock In";
                stockInButton.addEventListener("click", () =>
                    adjustStock(product, "stock-in", quantity, reason)
                );
                const stockOutButton = document.createElement("button");
                stockOutButton.type = "button";
                stockOutButton.className = "btn-stockout";
                stockOutButton.textContent = "Stock Out";
                stockOutButton.addEventListener("click", () =>
                    adjustStock(product, "stock-out", quantity, reason)
                );
                adjustment.append(quantity, reason, stockInButton, stockOutButton);
                actions.append(adjustment);
            }
            row.append(actions);
        }
        inventoryRows.append(row);
    }
}

function renderCategories() {
    categorySelect.replaceChildren();
    categoryFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All categories";
    categoryFilter.append(allOption);

    for (const category of categories) {
        const editorOption = document.createElement("option");
        editorOption.value = category.id;
        editorOption.textContent = category.categoryName;
        categorySelect.append(editorOption);

        const filterOption = editorOption.cloneNode(true);
        categoryFilter.append(filterOption);
    }
    renderCategoryManagement();
    categorySelect.disabled = categories.length === 0;
    document.getElementById("saveProductButton").disabled = categories.length === 0;
    if (categories.length === 0 && currentRole === "Admin") {
        showMessage("Add a product category before creating inventory items.", true);
    }
}

function renderCategoryManagement() {
    if (!categoryRows || currentRole !== "Admin") {
        return;
    }
    if (categories.length === 0) {
        appendEmptyRow(categoryRows, 2, "No categories found. Add one above.");
        return;
    }

    categoryRows.replaceChildren();
    for (const category of categories) {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = category.categoryName;
        nameInput.minLength = 2;
        nameInput.maxLength = 100;
        nameInput.disabled = true;
        nameInput.setAttribute("aria-label", `Category name: ${category.categoryName}`);
        nameCell.append(nameInput);
        row.append(nameCell);

        const actionsCell = document.createElement("td");
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.className = "btn-secondary";
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", async () => {
            if (nameInput.disabled) {
                nameInput.disabled = false;
                nameInput.focus();
                renameButton.textContent = "Save";
                cancelButton.hidden = false;
                return;
            }
            await renameCategory(category, nameInput.value);
        });
        actionsCell.append(renameButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "btn-stockout";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteCategory(category));
        actionsCell.append(deleteButton);

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn-secondary";
        cancelButton.textContent = "Cancel";
        cancelButton.hidden = true;
        cancelButton.addEventListener("click", () => {
            nameInput.value = category.categoryName;
            nameInput.disabled = true;
            renameButton.textContent = "Rename";
            cancelButton.hidden = true;
        });
        actionsCell.append(cancelButton);

        nameInput.addEventListener("input", () => {
            cancelButton.hidden = nameInput.disabled;
        });
        row.append(actionsCell);
        categoryRows.append(row);
    }
}

async function renameCategory(category, categoryName) {
    const normalizedName = categoryName.trim();
    if (normalizedName.length < 2 || normalizedName.length > 100) {
        showMessage("Category name must be between 2 and 100 characters.", true);
        return;
    }
    try {
        const result = await apiRequest(
            `/api/admin/inventory/categories/${encodeURIComponent(category.id)}`,
            { method: "PUT", body: JSON.stringify({ categoryName: normalizedName }) }
        );
        showMessage(result.message);
        await loadInventory();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function deleteCategory(category) {
    if (!window.confirm(`Delete category "${category.categoryName}"? This is allowed only if no products use it.`)) {
        return;
    }
    try {
        const result = await apiRequest(
            `/api/admin/inventory/categories/${encodeURIComponent(category.id)}`,
            { method: "DELETE" }
        );
        showMessage(result.message);
        await loadInventory();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function loadInventory() {
    const data = await apiRequest("/api/inventory");
    products = data.products;
    categories = data.categories;
    renderCategories();
    renderInventory();
}

function barcodeFormatFor(value) {
    return /^\d{13}$/.test(value) ? "EAN13" : "CODE128";
}

function renderBarcode(svg, value, productName) {
    if (!window.JsBarcode) {
        throw new Error("Barcode renderer is unavailable. Reload the page and try again.");
    }
    window.JsBarcode(svg, value, {
        format: barcodeFormatFor(value),
        displayValue: true,
        height: 60,
        width: 2,
        margin: 10,
        fontSize: 16
    });
    svg.setAttribute("aria-label", `Barcode for ${productName}: ${value}`);
}

function renderBarcodePreview() {
    const value = barcodeInput.value.trim();
    if (!value) {
        barcodePreviewSection.hidden = true;
        barcodePreviewSvg.replaceChildren();
        return;
    }

    barcodePreviewName.textContent = productNameInput.value.trim() || "New product";
    try {
        renderBarcode(barcodePreviewSvg, value, barcodePreviewName.textContent);
        barcodePreviewSection.hidden = false;
    } catch (error) {
        barcodePreviewSection.hidden = true;
        barcodePreviewSvg.replaceChildren();
        showMessage(error.message, true);
    }
}

function showInventoryBarcode(product) {
    const barcode = (product.barcode || "").trim();
    if (!barcode) {
        showMessage("This product does not have a barcode to print.", true);
        return;
    }
    dialogBarcodeProductName = product.productName;
    inventoryBarcodeTitle.textContent = product.productName;
    inventoryBarcodeValue.textContent = barcode;
    inventoryBarcodePreview.replaceChildren();
    try {
        renderBarcode(inventoryBarcodePreview, barcode, product.productName);
        inventoryBarcodeDialog.showModal();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function requestGeneratedBarcode() {
    try {
        const { barcode } = await apiRequest("/api/admin/inventory/next-barcode");
        barcodeInput.value = barcode;
        renderBarcodePreview();
        showMessage("Barcode preview generated. Print the label or save the product to use this barcode.");
    } catch (error) {
        showMessage(error.message, true);
    }
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function printBarcodeLabel(svg, value, productName) {
    if (!value) {
        showMessage("Generate or enter a barcode before printing.", true);
        return;
    }

    const safeProductName = escapeHtml(productName || "Product");
    const svgMarkup = new XMLSerializer().serializeToString(svg);
    const printWindow = window.open("", "_blank", "width=520,height=420");
    if (!printWindow) {
        showMessage("Allow pop-ups to print the barcode label.", true);
        return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Barcode label - ${safeProductName}</title>
<style>
body { font-family: Arial, sans-serif; text-align: center; padding: 24px; }
h1 { font-size: 18px; margin: 0 0 12px; }
p { font-size: 13px; color: #555; margin: 0 0 16px; }
</style>
</head>
<body>
<h1>${safeProductName}</h1>
<p>APB Merchandising</p>
${svgMarkup}
<script>
window.onload = function () {
    window.focus();
    window.print();
};
</script>
</body>
</html>`);
    printWindow.document.close();
}

function resetProductForm() {
    editingProductId = null;
    productForm.reset();
    barcodeInput.readOnly = false;
    generateBarcodeButton.hidden = false;
    document.getElementById("initialQuantity").value = "0";
    document.getElementById("initialQuantityGroup").hidden = false;
    document.getElementById("formHeading").textContent = "Add Product";
    document.getElementById("saveProductButton").textContent = "Add Product";
    document.getElementById("cancelEditButton").hidden = true;
    barcodePreviewSection.hidden = true;
    barcodePreviewSvg.replaceChildren();
    productEditor.hidden = true;
    showProductFormButton.hidden = false;
}

function startEditing(product) {
    editingProductId = product.id;
    barcodeInput.value = product.barcode || "";
    barcodeInput.readOnly = Boolean(product.barcode);
    generateBarcodeButton.hidden = Boolean(product.barcode);
    productNameInput.value = product.productName;
    categorySelect.value = product.categoryId || "";
    document.getElementById("unitPrice").value = product.unitPrice;
    document.getElementById("initialQuantityGroup").hidden = true;
    document.getElementById("formHeading").textContent = `Edit Product: ${product.productName}`;
    document.getElementById("saveProductButton").textContent = "Save Changes";
    document.getElementById("cancelEditButton").hidden = false;
    renderBarcodePreview();
    productEditor.hidden = false;
    showProductFormButton.hidden = true;
    productEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function updateProductStatus(product) {
    const isActive = !product.isActive;
    const action = isActive ? "reactivate" : "archive";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} "${product.productName}"?`)) {
        return;
    }
    try {
        const result = await apiRequest(
            `/api/admin/inventory/products/${encodeURIComponent(product.id)}/status`,
            { method: "PATCH", body: JSON.stringify({ isActive }) }
        );
        showMessage(result.message);
        await loadInventory();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function adjustStock(product, direction, quantityInput, reasonInput) {
    const quantity = Number(quantityInput.value);
    const reason = reasonInput.value.trim();
    if (!Number.isInteger(quantity) || quantity < 1) {
        showMessage("Enter a positive whole-number quantity.", true);
        quantityInput.focus();
        return;
    }
    if (direction === "stock-out" && !reason) {
        showMessage("Enter a reason for removing stock.", true);
        reasonInput.focus();
        return;
    }

    try {
        const result = await apiRequest(
            `/api/admin/inventory/products/${encodeURIComponent(product.id)}/${direction}`,
            { method: "POST", body: JSON.stringify({ quantity, reason }) }
        );
        showMessage(`${result.message} Current stock: ${result.stockQuantity}.`);
        await Promise.all([loadInventory(), loadMovements()]);
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function loadMovements() {
    if (currentRole !== "Admin") {
        return;
    }
    const { movements } = await apiRequest("/api/admin/inventory/movements");
    if (movements.length === 0) {
        appendEmptyRow(movementRows, 6, "No stock movements recorded yet.");
        return;
    }
    movementRows.replaceChildren();
    for (const movement of movements) {
        const row = document.createElement("tr");
        addCell(row, new Date(movement.date).toLocaleString());
        addCell(row, movement.type);
        addCell(row, `${movement.productName}${movement.barcode ? ` (${movement.barcode})` : ""}`);
        addCell(row, String(movement.quantity));
        addCell(row, movement.reason);
        addCell(row, movement.user);
        movementRows.append(row);
    }
}

categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("newCategoryName");
    try {
        const result = await apiRequest("/api/admin/inventory/categories", {
            method: "POST",
            body: JSON.stringify({ categoryName: input.value.trim() })
        });
        categoryForm.reset();
        showMessage(result.message);
        await loadInventory();
    } catch (error) {
        showMessage(error.message, true);
    }
});

productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const barcodeValue = barcodeInput.value.trim();
    const productBeforeEdit = editingProductId
        ? products.find((product) => product.id === editingProductId)
        : null;
    const payload = {
        barcode: barcodeValue,
        productName: productNameInput.value.trim(),
        categoryId: categorySelect.value,
        unitPrice: Number(document.getElementById("unitPrice").value)
    };
    if (!editingProductId) {
        payload.initialQuantity = Number(document.getElementById("initialQuantity").value);
    }
    try {
        const url = editingProductId
            ? `/api/admin/inventory/products/${encodeURIComponent(editingProductId)}`
            : "/api/admin/inventory/products";
        const result = await apiRequest(url, {
            method: editingProductId ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });
        resetProductForm();
        productEditor.hidden = true;
        showMessage(result.message);
        await Promise.all([loadInventory(), loadMovements()]);
    } catch (error) {
        showMessage(error.message, true);
    }
});

document.getElementById("cancelEditButton").addEventListener("click", () => {
    resetProductForm();
    productEditor.hidden = true;
});
showProductFormButton.addEventListener("click", () => {
    resetProductForm();
    productEditor.hidden = false;
    showProductFormButton.hidden = true;
    productEditor.scrollIntoView({ behavior: "smooth", block: "start" });
});
generateBarcodeButton.addEventListener("click", requestGeneratedBarcode);
printBarcodeButton.addEventListener("click", () =>
    printBarcodeLabel(
        barcodePreviewSvg,
        barcodeInput.value.trim(),
        productNameInput.value.trim() || "Product"
    )
);
document.getElementById("closeInventoryBarcodeButton").addEventListener("click", () => {
    inventoryBarcodeDialog.close();
});
document.getElementById("printInventoryBarcodeButton").addEventListener("click", () =>
    printBarcodeLabel(
        inventoryBarcodePreview,
        inventoryBarcodeValue.textContent,
        dialogBarcodeProductName
    )
);
inventoryBarcodeDialog.addEventListener("click", (event) => {
    if (event.target === inventoryBarcodeDialog) {
        inventoryBarcodeDialog.close();
    }
});
barcodeInput.addEventListener("input", () => {
    renderBarcodePreview();
});
productNameInput.addEventListener("input", () => {
    if (!barcodePreviewSection.hidden) {
        renderBarcodePreview();
    }
});
document.getElementById("inventorySearch").addEventListener("input", renderInventory);
categoryFilter.addEventListener("change", renderInventory);
document.getElementById("stockStatusFilter").addEventListener("change", renderInventory);
document.getElementById("statusFilter").addEventListener("change", renderInventory);
document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

async function initializeInventory() {
    if (!localStorage.getItem("token")) {
        window.location.replace("/");
        return;
    }
    try {
        const { user } = await apiRequest("/api/profile");
        currentRole = user.role;
        document.getElementById("userInfo").textContent = `${user.fullName} (@${user.username})`;
        document.getElementById("accessDescription").textContent = currentRole === "Admin"
            ? "Manage products and stock. Stock changes are recorded in the movement history."
            : "Active Inventory of APB Merchandising.";
        for (const element of document.querySelectorAll(".admin-only")) {
            element.hidden = currentRole !== "Admin";
        }
        productEditor.hidden = true;
        document.getElementById("statusFilterGroup").hidden = currentRole !== "Admin";
        document.getElementById("actionsHeading").hidden = currentRole !== "Admin";
        document.getElementById("historySection").hidden = currentRole !== "Admin";
        inventoryPage.hidden = false;
        await loadInventory();
        if (currentRole === "Admin") {
            await loadMovements();
        }
    } catch (error) {
        inventoryPage.hidden = false;
        showMessage(error.message, true);
        console.error("Unable to load inventory:", error);
    }
}

initializeInventory();
