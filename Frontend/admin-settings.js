const accountForm = document.getElementById("accountForm");
const accountsList = document.getElementById("accountsList");
const statusMessage = document.getElementById("statusMessage");
const passwordInput = document.getElementById("password");
const formHeading = document.getElementById("formHeading");
const saveAccountButton = document.getElementById("saveAccountButton");
const cancelEditButton = document.getElementById("cancelEditButton");

let currentUserId;
let editingUserId = null;

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

function resetAccountForm() {
    editingUserId = null;
    accountForm.reset();
    passwordInput.required = true;
    passwordInput.placeholder = "";
    document.getElementById("passwordHelp").textContent = "At least 6 characters.";
    formHeading.textContent = "Create Account";
    saveAccountButton.textContent = "Create Account";
    cancelEditButton.hidden = true;
}

function renderAccounts(users) {
    accountsList.replaceChildren();

    if (users.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "No accounts found.";
        row.append(cell);
        accountsList.append(row);
        window.makeTableSortable(accountsList.closest("table"));
        return;
    }

    for (const user of users) {
        const row = document.createElement("tr");
        for (const value of [user.username, user.fullName, user.role]) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
        }
        const createdCell = document.createElement("td");
        createdCell.textContent = user.createdAt
            ? new Date(user.createdAt).toLocaleDateString()
            : "—";
        if (user.createdAt) {
            createdCell.dataset.sortValue = new Date(user.createdAt).toISOString();
        }
        row.append(createdCell);

        const actionsCell = document.createElement("td");
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "account-action-btn";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => startEditing(user));
        actionsCell.append(editButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "account-action-btn delete-account-btn";
        deleteButton.textContent = "Delete";
        deleteButton.disabled = user.id === currentUserId;
        deleteButton.title = deleteButton.disabled
            ? "You cannot delete your own account."
            : "Delete account";
        deleteButton.addEventListener("click", () => deleteAccount(user));
        actionsCell.append(deleteButton);
        row.append(actionsCell);
        accountsList.append(row);
    }
    window.makeTableSortable(accountsList.closest("table"));
}

function startEditing(user) {
    editingUserId = user.id;
    document.getElementById("username").value = user.username;
    document.getElementById("fullName").value = user.fullName;
    document.getElementById("role").value = user.role;
    passwordInput.value = "";
    passwordInput.required = false;
    passwordInput.placeholder = "Leave blank to keep current password";
    document.getElementById("passwordHelp").textContent =
        "Leave blank to keep the current password, or enter at least 6 characters.";
    formHeading.textContent = `Edit Account: ${user.username}`;
    saveAccountButton.textContent = "Save Changes";
    cancelEditButton.hidden = false;
    accountForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadAccounts() {
    const { users } = await apiRequest("/api/admin/users");
    renderAccounts(users);
}

async function deleteAccount(user) {
    if (!window.confirm(`Delete the account for "${user.username}"? This cannot be undone.`)) {
        return;
    }

    try {
        const data = await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, {
            method: "DELETE"
        });
        resetAccountForm();
        showMessage(data.message);
        await loadAccounts();
    } catch (error) {
        showMessage(error.message, true);
    }
}

accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        username: document.getElementById("username").value.trim(),
        fullName: document.getElementById("fullName").value.trim(),
        role: document.getElementById("role").value
    };
    const password = passwordInput.value;
    if (password) {
        payload.password = password;
    }

    try {
        const url = editingUserId
            ? `/api/admin/users/${encodeURIComponent(editingUserId)}`
            : "/api/admin/users";
        const data = await apiRequest(url, {
            method: editingUserId ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });
        resetAccountForm();
        showMessage(data.message);
        await loadAccounts();
    } catch (error) {
        showMessage(error.message, true);
    }
});

cancelEditButton.addEventListener("click", resetAccountForm);

async function authorizeAdminSettings() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.replace("/");
        return;
    }

    try {
        const { user } = await apiRequest("/api/profile");
        if (user.role !== "Admin") {
            window.location.replace("dashboard.html");
            return;
        }

        currentUserId = user.id;
        document.getElementById("userInfo").textContent =
            `${user.fullName} (@${user.username})`;
        document.getElementById("adminSettings").hidden = false;
        await loadAccounts();
    } catch (error) {
        showMessage(error.message, true);
        console.error("Unable to load admin account settings:", error);
    }
}

document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.replace("/");
});

authorizeAdminSettings();
