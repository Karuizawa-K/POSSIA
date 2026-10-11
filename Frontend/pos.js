const productGrid = document.getElementById("product-grid");
const cartGrid = document.getElementById("cart-items");
const productSearch = document.getElementById("product-search");
const cart = new Map();
let products = [];
let discountCents = 0;
let selectedPaymentMethod = null;
let checkoutInProgress = false;

const currency = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
});

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

function makeCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

function getSubtotalCents() {
    return [...cart.values()].reduce(
        (sum, { product, quantity }) =>
            sum + Math.round(product.unitPrice * 100) * quantity,
        0
    );
}

function renderProducts() {
    const query = productSearch.value.trim().toLowerCase();
    const visibleProducts = products.filter((product) =>
        product.productName.toLowerCase().includes(query) ||
        product.barcode.toLowerCase().includes(query)
    );

    productGrid.replaceChildren();
    if (visibleProducts.length === 0) {
        showGridMessage(productGrid, products.length ? "No matching items." : "No items available.");
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
}

function addToCart(product) {
    const selected = cart.get(product.id);
    if (selected) {
        if (selected.quantity >= product.stockQuantity) {
            return;
        }
        selected.quantity += 1;
    } else if (product.stockQuantity > 0) {
        cart.set(product.id, { product, quantity: 1 });
    }

    renderCart();
}

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

        const quantityText = document.createElement("span");
        quantityText.textContent = ` ${quantity} `;

        const increaseButton = document.createElement("button");
        increaseButton.type = "button";
        increaseButton.className = "qty-btn";
        increaseButton.textContent = "+";
        increaseButton.setAttribute("aria-label", `Add one ${product.productName}`);
        increaseButton.disabled = quantity >= product.stockQuantity;
        increaseButton.addEventListener("click", () => changeQuantity(productId, 1));
        quantityCell.append(decreaseButton, quantityText, increaseButton);

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
}

async function loadPos() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.replace("/");
        return;
    }

    try {
        const [profileResponse, productsResponse] = await Promise.all([
            fetch("/api/profile", {
                headers: { Authorization: `Bearer ${token}` }
            }),
            fetch("/api/products", {
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
        document.getElementById("userInfo").textContent =
            `${profileData.user.fullName} (@${profileData.user.username})`;
        products = productsData.products;
        renderProducts();
        renderCart();
    } catch (error) {
        console.error("Unable to load POS items:", error);
        showGridMessage(productGrid, "Unable to load items. Please refresh and try again.");
    }
}

async function refreshProducts() {
    const token = localStorage.getItem("token");
    try {
        const response = await fetch("/api/products", {
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

productSearch.addEventListener("input", renderProducts);
document.getElementById("clear-btn").addEventListener("click", () => {
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
        paymentInput.value = "";
        paymentInput.inputMode = "decimal";
        paymentInput.autocomplete = "off";
        paymentInput.required = true;
    } else {
        paymentTitle.textContent = "GCash Payment";
        paymentLabel.textContent = "GCash reference number";
        paymentInput.type = "text";
        paymentInput.removeAttribute("min");
        paymentInput.removeAttribute("step");
        paymentInput.value = "";
        paymentInput.inputMode = "text";
        paymentInput.autocomplete = "off";
        paymentInput.required = true;
    }

    document.getElementById("payment-error").textContent = "";
    document.getElementById("payment-dialog").showModal();
    paymentInput.focus();
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
        if (!inputValue) {
            document.getElementById("payment-error").textContent =
                "Enter the GCash reference number.";
            return;
        }
        payload.referenceNumber = inputValue;
    }

    const token = localStorage.getItem("token");
    checkoutInProgress = true;
    renderCart();
    try {
        const response = await fetch("/api/sales", {
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
        cart.clear();
        discountCents = 0;
        selectedPaymentMethod = null;
        document.querySelectorAll("[data-method]").forEach((button) => {
            button.classList.remove("payment-selected");
            button.setAttribute("aria-pressed", "false");
        });
        renderCart();
        window.alert(
            `Sale completed. Receipt: ${data.sale.receiptNumber}` +
            (completedPaymentMethod === "Cash"
                ? `\nChange: ${currency.format(data.sale.changeAmount)}`
                : "")
        );
        await refreshProducts();
    } catch (error) {
        console.error("Unable to complete sale:", error);
        document.getElementById("payment-error").textContent = error.message;
    } finally {
        checkoutInProgress = false;
        renderCart();
    }
});

document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

loadPos();
