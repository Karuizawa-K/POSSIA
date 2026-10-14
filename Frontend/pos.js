

const apiUrl = window.apiUrl || ((path) => path);
const productGrid = document.getElementById("product-grid");
const cartGrid = document.getElementById("cart-items");
const productSearch = document.getElementById("product-search");
const cart = new Map();
let products = [];
let discountCents = 0;
let selectedPaymentMethod = null;
let checkoutInProgress = false;
const gcashReferenceNumberPattern = /^\d{13}$/;
let barcodeReader = null;
let barcodeControls = null;
let lastScannedBarcode = "";
let lastScannedAt = 0;
let scanAudioContext = null;

const currency = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
});

// Replaces a grid's rows with a single message row.
function showGridMessage(grid, message) {
    grid.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = grid === productGrid ? 5 : 4;
    cell.className = "grid-empty";
    cell.textContent = message;
    row.append(cell);
    grid.append(row);
}

// Creates a text cell for a table row.
function makeCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

// Returns the cart subtotal in centavos.
function getSubtotalCents() {
    return [...cart.values()].reduce(
        (sum, { product, quantity }) =>
            sum + Math.round(product.unitPrice * 100) * quantity,
        0
    );
}

// Populates and opens the receipt dialog.
function showReceipt(receipt) {
    const setReceiptText = (id, value) => {
        document.getElementById(id).textContent = value;
    };
    const receiptItemList = document.getElementById("receipt-item-list");
    receiptItemList.replaceChildren();

    for (const item of receipt.items) {
        const row = document.createElement("tr");
        row.append(
            makeCell(item.productName),
            makeCell(String(item.quantity)),
            makeCell(currency.format(item.unitPrice)),
            makeCell(currency.format(item.subtotal))
        );
        receiptItemList.append(row);
    }
    window.makeTableSortable(document.querySelector(".receipt-items"));

    setReceiptText("receipt-number", receipt.receiptNumber);
    setReceiptText("receipt-date", new Date(receipt.receiptDate).toLocaleString());
    setReceiptText("receipt-cashier", receipt.cashier);
    setReceiptText("receipt-subtotal", currency.format(receipt.subtotal));
    setReceiptText("receipt-discount", currency.format(receipt.discount));
    setReceiptText("receipt-total", currency.format(receipt.totalAmount));
    setReceiptText(
        "receipt-payment",
        receipt.paymentMethod === "Cash"
            ? `Cash received: ${currency.format(receipt.amountPaid)}`
            : `GCash: ${currency.format(receipt.amountPaid)}`
    );
    setReceiptText("receipt-change", currency.format(receipt.changeAmount));
    document.getElementById("receipt-reference-row").hidden = !receipt.referenceNumber;
    setReceiptText("receipt-reference", receipt.referenceNumber || "");
    document.getElementById("receipt-dialog").showModal();
}

// Renders the catalog table for the current search.
function renderProducts() {
    const query = productSearch.value.trim().toLowerCase();
    const visibleProducts = products.filter((product) =>
        product.productName.toLowerCase().includes(query) ||
        (product.barcode || "").toLowerCase().includes(query)
    );

    productGrid.replaceChildren();
    if (visibleProducts.length === 0) {
        showGridMessage(productGrid, products.length ? "No matching items." : "No items available.");
        window.makeTableSortable(productGrid.closest("table"));
        return;
    }

    for (const product of visibleProducts) {
        const row = document.createElement("tr");
        row.append(
            makeCell(product.productName),
            makeCell(product.barcode),
            makeCell(currency.format(product.unitPrice)),
            makeCell(String(product.stockQuantity))
        );

        const actionCell = document.createElement("td");
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "grid-add-btn";
        addButton.textContent = "Add";
        addButton.setAttribute("aria-label", `Add ${product.productName}`);
        addButton.disabled = product.stockQuantity <= 0;
        addButton.addEventListener("click", () => addToCart(product));
        actionCell.append(addButton);
        row.append(actionCell);
        productGrid.append(row);
    }
    window.makeTableSortable(productGrid.closest("table"));
}

// Adds units of a product to the cart if stock allows.
function addToCart(product, quantity = 1) {
    const selected = cart.get(product.id);
    const currentQuantity = selected ? selected.quantity : 0;
    if (!Number.isInteger(quantity) || quantity < 1 ||
        currentQuantity + quantity > product.stockQuantity) {
        return false;
    }

    if (selected) {
        selected.quantity += quantity;
    } else if (product.stockQuantity > 0) {
        cart.set(product.id, { product, quantity });
    } else {
        return false;
    }

    renderCart();
    return true;
}

// Steps a cart line's quantity by the given amount.
function changeQuantity(productId, change) {
    const selected = cart.get(productId);
    if (!selected) {
        return;
    }

    selected.quantity += change;
    if (selected.quantity <= 0) {
        cart.delete(productId);
    } else if (selected.quantity > selected.product.stockQuantity) {
        selected.quantity = selected.product.stockQuantity;
    }

    renderCart();
}

// Applies a quantity typed into a cart line, or reverts it.
function commitTypedQuantity(productId, rawValue) {
    const selected = cart.get(productId);
    if (!selected) {
        return;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        renderCart();
        return;
    }
    if (parsed > selected.product.stockQuantity) {
        window.alert(`Only ${selected.product.stockQuantity} × ${selected.product.productName} in stock.`);
        renderCart();
        return;
    }
    if (parsed === selected.quantity) {
        return;
    }

    selected.quantity = parsed;
    renderCart();
}

// Renders cart lines, totals, and checkout state.
function renderCart() {
    cartGrid.replaceChildren();
    if (cart.size === 0) {
        discountCents = 0;
        showGridMessage(cartGrid, "No items selected.");
        document.getElementById("subtotal").textContent = currency.format(0);
        document.getElementById("discount").textContent = currency.format(0);
        document.getElementById("total").textContent = currency.format(0);
        document.getElementById("checkout-btn").textContent =
            `Checkout • ${currency.format(0)}`;
        document.getElementById("checkout-btn").disabled = true;
        document.getElementById("discount-btn").disabled = true;
        window.makeTableSortable(cartGrid.closest("table"));
        return;
    }

    let subtotalCents = 0;
    for (const [productId, selected] of cart) {
        const { product, quantity } = selected;
        const unitPriceCents = Math.round(product.unitPrice * 100);
        const amountCents = unitPriceCents * quantity;
        subtotalCents += amountCents;

        const row = document.createElement("tr");
        row.append(
            makeCell(product.productName),
            makeCell(currency.format(unitPriceCents / 100))
        );

        const quantityCell = document.createElement("td");
        const decreaseButton = document.createElement("button");
        decreaseButton.type = "button";
        decreaseButton.className = "qty-btn";
        decreaseButton.textContent = "−";
        decreaseButton.setAttribute("aria-label", `Remove one ${product.productName}`);
        decreaseButton.addEventListener("click", () => changeQuantity(productId, -1));

        const quantityInput = document.createElement("input");
        quantityInput.type = "number";
        quantityInput.className = "qty-input";
        quantityInput.min = "1";
        quantityInput.step = "1";
        quantityInput.inputMode = "numeric";
        quantityInput.value = String(quantity);
        quantityInput.max = String(product.stockQuantity);
        quantityInput.setAttribute("aria-label", `Quantity for ${product.productName}`);
        quantityInput.addEventListener("change", () =>
            commitTypedQuantity(productId, quantityInput.value)
        );
        quantityInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commitTypedQuantity(productId, quantityInput.value);
            }
        });

        const increaseButton = document.createElement("button");
        increaseButton.type = "button";
        increaseButton.className = "qty-btn";
        increaseButton.textContent = "+";
        increaseButton.setAttribute("aria-label", `Add one ${product.productName}`);
        increaseButton.disabled = quantity >= product.stockQuantity;
        increaseButton.addEventListener("click", () => changeQuantity(productId, 1));
        quantityCell.append(decreaseButton, quantityInput, increaseButton);

        row.append(quantityCell, makeCell(currency.format(amountCents / 100)));
        cartGrid.append(row);
    }

    discountCents = Math.min(discountCents, subtotalCents);
    const totalCents = subtotalCents - discountCents;
    document.getElementById("subtotal").textContent = currency.format(subtotalCents / 100);
    document.getElementById("discount").textContent = currency.format(discountCents / 100);
    document.getElementById("total").textContent = currency.format(totalCents / 100);
    const checkoutButton = document.getElementById("checkout-btn");
    checkoutButton.textContent = `Checkout • ${currency.format(totalCents / 100)}`;
    checkoutButton.disabled = !selectedPaymentMethod || checkoutInProgress;
    document.getElementById("discount-btn").disabled = false;
    window.makeTableSortable(cartGrid.closest("table"));
}

// Loads the profile and product catalog for the POS.
async function loadPos() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.replace("/");
        return;
    }

    try {
        const [profileResponse, productsResponse] = await Promise.all([
            fetch(apiUrl("/api/profile"), {
                headers: { Authorization: `Bearer ${token}` }
            }),
            fetch(apiUrl("/api/products"), {
                headers: { Authorization: `Bearer ${token}` }
            })
        ]);

        if (profileResponse.status === 401 || productsResponse.status === 401) {
            localStorage.removeItem("token");
            window.location.replace("/");
            return;
        }
        if (!profileResponse.ok || !productsResponse.ok) {
            throw new Error("Unable to load your account or items.");
        }

        const [profileData, productsData] = await Promise.all([
            profileResponse.json(),
            productsResponse.json()
        ]);
        document.getElementById("userInfo").textContent = profileData.user.fullName;
        
        document.getElementById("pageSubtitle").textContent =
            profileData.user.role === "Admin" ? "Point of Sale • Admin Access" : "Point of Sale";
        products = productsData.products;
        renderProducts();
        renderCart();
    } catch (error) {
        console.error("Unable to load POS items:", error);
        showGridMessage(productGrid, "Unable to load items. Please refresh and try again.");
    }
}

// Reloads stock levels after a completed sale.
async function refreshProducts() {
    const token = localStorage.getItem("token");
    try {
        const response = await fetch(apiUrl("/api/products"), {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.status === 401) {
            localStorage.removeItem("token");
            window.location.replace("/");
            return;
        }
        if (!response.ok) {
            throw new Error("Unable to refresh available stock.");
        }
        const data = await response.json();
        products = data.products;
        renderProducts();
    } catch (error) {
        console.error("Unable to refresh products:", error);
        showGridMessage(productGrid, "Sale completed, but stock could not be refreshed. Reload the page.");
    }
}

// Stops the camera stream and releases it.
function stopBarcodeScanner() {
    if (barcodeControls) {
        barcodeControls.stop();
        barcodeControls = null;
    }
    const video = document.getElementById("barcode-video");
    for (const track of video.srcObject?.getTracks() || []) {
        track.stop();
    }
    video.srcObject = null;
}

// Plays a short tone to confirm or reject a scan.
function playScanBeep(success = true) {
    try {
        scanAudioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        if (scanAudioContext.state === "suspended") {
            scanAudioContext.resume();
        }
        const oscillator = scanAudioContext.createOscillator();
        const gain = scanAudioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = success ? 880 : 220;
        gain.gain.value = 0.15;
        oscillator.connect(gain);
        gain.connect(scanAudioContext.destination);
        oscillator.start();
        oscillator.stop(scanAudioContext.currentTime + (success ? 0.12 : 0.25));
    } catch (error) {
        
    }
}

// Reads the quantity to add per scanned barcode.
function scanQuantityPerScan() {
    const value = Number.parseInt(document.getElementById("scan-qty-per").value, 10);
    return Number.isInteger(value) && value > 0 ? value : 1;
}




// Adds a scanned item to the cart while scanning continues.
function handleScannedBarcode(barcode) {
    const now = Date.now();
    
    
    if (barcode === lastScannedBarcode && now - lastScannedAt < 800) {
        return;
    }
    lastScannedBarcode = barcode;
    lastScannedAt = now;

    const normalized = (barcode || "").trim();
    const product = products.find((item) => (item.barcode || "").trim() === normalized);
    const status = document.getElementById("scanner-status");
    const lastScan = document.getElementById("last-scan");
    if (!product) {
        playScanBeep(false);
        status.textContent =
            `No item found for barcode ${normalized}. Try another barcode.`;
        return;
    }
    if (product.stockQuantity <= 0) {
        playScanBeep(false);
        status.textContent =
            `${product.productName} is out of stock.`;
        return;
    }
    const alreadySelected = cart.get(product.id)?.quantity || 0;
    const available = product.stockQuantity - alreadySelected;
    if (available <= 0) {
        playScanBeep(false);
        status.textContent =
            `All available stock for ${product.productName} is already in the order.`;
        return;
    }
    const requested = scanQuantityPerScan();
    const added = Math.min(requested, available);
    if (!addToCart(product, added)) {
        playScanBeep(false);
        status.textContent =
            `Could not add ${product.productName}. Quantity exceeds available stock.`;
        return;
    }
    playScanBeep(true);
    lastScan.textContent = `Added ${added} × ${product.productName} (${normalized})`;
    status.textContent = requested > available
        ? `Only ${available} left for ${product.productName} — added ${added}. Keep scanning, or press Close.`
        : "Camera active. Keep scanning, or press Close when done.";
}

// Requests the camera and begins decoding barcodes.
async function startBarcodeScanner() {
    if (barcodeControls) {
        return;
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
        document.getElementById("scanner-status").textContent =
            "Camera access requires a secure HTTPS connection.";
        return;
    }
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
        document.getElementById("scanner-status").textContent =
            "Barcode scanner could not be loaded. Refresh the page and try again.";
        return;
    }

    const video = document.getElementById("barcode-video");
    document.getElementById("scanner-status").textContent =
        "Requesting camera access...";

    try {
        barcodeReader ||= new window.ZXingBrowser.BrowserMultiFormatReader();
        barcodeControls = await barcodeReader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            video,
            (result, error) => {
                if (result) {
                    handleScannedBarcode(result.getText());
                } else if (error && error.name !== "NotFoundException" &&
                    error.name !== "ChecksumException" && error.name !== "FormatException") {
                    console.error("Barcode scan error:", error);
                }
            }
        );
        document.getElementById("scanner-status").textContent =
            "Camera active. Position a barcode in the view.";
    } catch (error) {
        console.error("Unable to start barcode camera:", error);
        document.getElementById("scanner-status").textContent =
            error.name === "NotAllowedError"
                ? "Camera permission was denied. Allow camera access in browser settings, then close and reopen to try again."
                : "Unable to start the camera. Check camera access, then close and reopen to try again.";
        stopBarcodeScanner();
    }
}

productSearch.addEventListener("input", renderProducts);
document.getElementById("clear-btn").addEventListener("click", () => {
    if (cart.size > 0 && !window.confirm(`Clear the current order? This removes all ${cart.size} item(s).`)) {
        return;
    }
    cart.clear();
    discountCents = 0;
    selectedPaymentMethod = null;
    document.querySelectorAll("[data-method]").forEach((button) => {
        button.classList.remove("payment-selected");
        button.setAttribute("aria-pressed", "false");
    });
    renderCart();
});

document.getElementById("discount-btn").addEventListener("click", () => {
    const subtotalCents = getSubtotalCents();
    const discountInput = document.getElementById("discount-amount");
    discountInput.max = String(subtotalCents / 100);
    discountInput.value = (discountCents / 100).toFixed(2);
    document.getElementById("discount-error").textContent = "";
    document.getElementById("discount-dialog").showModal();
    discountInput.focus();
});



document.getElementById("cancel-discount-btn").addEventListener("click", () => {
    document.getElementById("discount-error").textContent = "";
    document.getElementById("discount-dialog").close();
});

document.getElementById("discount-form").addEventListener("submit", (event) => {
    if (event.submitter.value !== "apply") {
        return;
    }
    event.preventDefault();

    const discountAmount = Number(document.getElementById("discount-amount").value);
    const subtotalCents = getSubtotalCents();
    const requestedDiscountCents = Math.round(discountAmount * 100);
    if (
        !Number.isFinite(discountAmount) ||
        discountAmount < 0 ||
        requestedDiscountCents > subtotalCents
    ) {
        document.getElementById("discount-error").textContent =
            "Discount must be between ₱0.00 and the current subtotal.";
        return;
    }

    discountCents = requestedDiscountCents;
    document.getElementById("discount-dialog").close();
    renderCart();
});

document.querySelectorAll("[data-method]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
        selectedPaymentMethod = button.dataset.method;
        document.querySelectorAll("[data-method]").forEach((methodButton) => {
            const isSelected = methodButton === button;
            methodButton.classList.toggle("payment-selected", isSelected);
            methodButton.setAttribute("aria-pressed", String(isSelected));
        });
        renderCart();
    });
});

document.getElementById("checkout-btn").addEventListener("click", () => {
    if (!selectedPaymentMethod || cart.size === 0 || checkoutInProgress) {
        return;
    }

    const paymentInput = document.getElementById("payment-input");
    const paymentLabel = document.getElementById("payment-input-label");
    const paymentTitle = document.getElementById("payment-dialog-title");
    if (selectedPaymentMethod === "Cash") {
        paymentTitle.textContent = "Cash Payment";
        paymentLabel.textContent = "Amount received (₱)";
        paymentInput.type = "number";
        paymentInput.min = String((getSubtotalCents() - discountCents) / 100);
        paymentInput.step = "0.01";
        paymentInput.inputMode = "decimal";
        paymentInput.removeAttribute("maxlength");
        paymentInput.removeAttribute("minlength");
        paymentInput.removeAttribute("pattern");
        paymentInput.placeholder = "";
        paymentInput.value = "";
        paymentInput.autocomplete = "off";
        paymentInput.required = true;
        paymentInput.setCustomValidity("");
    } else {
        paymentTitle.textContent = "GCash Payment";
        paymentLabel.textContent = "GCash reference number (13 digits)";
        paymentInput.type = "text";
        paymentInput.removeAttribute("min");
        paymentInput.removeAttribute("step");
        paymentInput.inputMode = "numeric";
        paymentInput.maxLength = 13;
        paymentInput.minLength = 13;
        paymentInput.pattern = "[0-9]{13}";
        paymentInput.placeholder = "Enter 13 digits";
        paymentInput.value = "";
        paymentInput.autocomplete = "off";
        paymentInput.required = true;
        paymentInput.setCustomValidity("");
    }

    document.getElementById("payment-error").textContent = "";
    document.getElementById("payment-dialog").showModal();
    paymentInput.focus();
});

document.getElementById("payment-input").addEventListener("input", (event) => {
    if (selectedPaymentMethod === "GCash") {
        event.target.setCustomValidity(
            event.target.value === "" || gcashReferenceNumberPattern.test(event.target.value)
                ? ""
                : "Enter exactly 13 digits from the GCash transaction receipt."
        );
    }
});

document.getElementById("cancel-payment-btn").addEventListener("click", () => {
    document.getElementById("payment-error").textContent = "";
    document.getElementById("payment-dialog").close();
});

document.getElementById("payment-form").addEventListener("submit", async (event) => {
    if (event.submitter.value !== "confirm") {
        return;
    }
    event.preventDefault();

    const inputValue = document.getElementById("payment-input").value.trim();
    const payload = {
        items: [...cart.entries()].map(([productId, selected]) => ({
            productId,
            quantity: selected.quantity
        })),
        discount: discountCents / 100,
        paymentMethod: selectedPaymentMethod
    };

    if (selectedPaymentMethod === "Cash") {
        payload.amountPaid = Number(inputValue);
        const total = (getSubtotalCents() - discountCents) / 100;
        if (!Number.isFinite(payload.amountPaid) || payload.amountPaid < total) {
            document.getElementById("payment-error").textContent =
                "Amount received must be at least the total due.";
            return;
        }
    } else {
        if (!gcashReferenceNumberPattern.test(inputValue)) {
            document.getElementById("payment-error").textContent =
                "GCash reference number must contain exactly 13 digits.";
            return;
        }
        payload.referenceNumber = inputValue;
    }

    const totalDue = (getSubtotalCents() - discountCents) / 100;
    if (!window.confirm(`Complete this ${selectedPaymentMethod} sale of ${currency.format(totalDue)}?`)) {
        return;
    }
    const token = localStorage.getItem("token");
    checkoutInProgress = true;
    renderCart();
    try {
        const response = await fetch(apiUrl("/api/sales"), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.status === 401) {
            localStorage.removeItem("token");
            window.location.replace("/");
            return;
        }
        if (!response.ok) {
            throw new Error(data.message || "Unable to complete the sale.");
        }

        document.getElementById("payment-dialog").close();
        document.getElementById("payment-error").textContent = "";
        const completedPaymentMethod = selectedPaymentMethod;
        const receipt = data.receipt;
        cart.clear();
        discountCents = 0;
        selectedPaymentMethod = null;
        document.querySelectorAll("[data-method]").forEach((button) => {
            button.classList.remove("payment-selected");
            button.setAttribute("aria-pressed", "false");
        });
        renderCart();
        if (receipt) {
            showReceipt(receipt);
        } else {
            window.alert(
                `Sale completed. Receipt: ${data.sale.receiptNumber}` +
                (completedPaymentMethod === "Cash"
                    ? `\nChange: ${currency.format(data.sale.changeAmount)}`
                    : "")
            );
        }
        await refreshProducts();
    } catch (error) {
        console.error("Unable to complete sale:", error);
        document.getElementById("payment-error").textContent = error.message;
    } finally {
        checkoutInProgress = false;
        renderCart();
    }
});

document.getElementById("scan-barcode-btn").addEventListener("click", () => {
    document.getElementById("scanner-status").textContent =
        "Position the barcode inside the camera view.";
    document.getElementById("last-scan").textContent = "";
    document.getElementById("scanner-dialog").showModal();
    startBarcodeScanner();
});

document.getElementById("close-scanner-btn").addEventListener("click", () => {
    stopBarcodeScanner();
    document.getElementById("scanner-dialog").close();
});
document.getElementById("scanner-dialog").addEventListener("close", stopBarcodeScanner);

document.getElementById("print-receipt-btn").addEventListener("click", () => {
    window.print();
});

document.getElementById("close-receipt-btn").addEventListener("click", () => {
    document.getElementById("receipt-dialog").close();
});



for (const dialogId of [
    "discount-dialog",
    "payment-dialog",
    "scanner-dialog",
    "receipt-dialog",
]) {
    const dialog = document.getElementById(dialogId);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });
}

document.getElementById("refreshButton").addEventListener("click", () => {
    
    if (cart.size > 0) {
        const confirmed = window.confirm(
            "Refreshing clears the current order. Continue?"
        );
        if (!confirmed) {
            return;
        }
    }
    window.location.reload();
});

document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

loadPos();
