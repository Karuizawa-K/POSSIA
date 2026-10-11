const productGrid = document.getElementById("product-grid");
const cartGrid = document.getElementById("cart-items");
const productSearch = document.getElementById("product-search");
const cart = new Map();
let products = [];

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
        showGridMessage(cartGrid, "No items selected.");
        document.getElementById("subtotal").textContent = currency.format(0);
        document.getElementById("discount").textContent = currency.format(0);
        document.getElementById("total").textContent = currency.format(0);
        document.getElementById("checkout-btn").textContent =
            `Checkout • ${currency.format(0)}`;
        return;
    }

    let subtotal = 0;
    for (const [productId, selected] of cart) {
        const { product, quantity } = selected;
        const amount = product.unitPrice * quantity;
        subtotal += amount;

        const row = document.createElement("tr");
        row.append(
            makeCell(product.productName),
            makeCell(currency.format(product.unitPrice))
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

        row.append(quantityCell, makeCell(currency.format(amount)));
        cartGrid.append(row);
    }

    document.getElementById("subtotal").textContent = currency.format(subtotal);
    document.getElementById("discount").textContent = currency.format(0);
    document.getElementById("total").textContent = currency.format(subtotal);
    document.getElementById("checkout-btn").textContent =
        `Checkout • ${currency.format(subtotal)}`;
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

productSearch.addEventListener("input", renderProducts);
document.getElementById("clear-btn").addEventListener("click", () => {
    cart.clear();
    renderCart();
});
document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

loadPos();
