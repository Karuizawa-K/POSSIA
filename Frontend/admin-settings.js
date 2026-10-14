const apiUrl = window.apiUrl || ((path) => path);
const accountForm = document.getElementById("accountForm");
const accountsList = document.getElementById("accountsList");
const statusMessage = document.getElementById("statusMessage");
const passwordInput = document.getElementById("password");
const formHeading = document.getElementById("formHeading");
const saveAccountButton = document.getElementById("saveAccountButton");
const cancelEditButton = document.getElementById("cancelEditButton");

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    button.addEventListener("click", () => {
        const showPassword = input.type === "password";
        input.type = showPassword ? "text" : "password";
        button.textContent = showPassword ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(showPassword));
    });
});

let currentUserId;
let editingUserId = null;
let issuedRecoveryCodes = [];

// Writes the page status line, optionally as an error.
function showMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error-message", isError);
}

// Sends an authenticated API request and throws on failure.
async function apiRequest(url, options = {}) {
    const token = localStorage.getItem("token");
    const response = await fetch(apiUrl(url), {
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

// Returns the account form to create-account mode.
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

// Renders the accounts table with edit and archive controls.
function renderAccounts(users) {
    accountsList.replaceChildren();

    if (users.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.textContent = "No accounts found.";
        row.append(cell);
        accountsList.append(row);
        window.makeTableSortable(accountsList.closest("table"));
        return;
    }

    for (const user of users) {
        const row = document.createElement("tr");
        const isArchived = user.isActive === false;
        for (const value of [user.username, user.fullName, user.role]) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
        }
        const statusCell = document.createElement("td");
        statusCell.textContent = isArchived ? "Archived" : "Active";
        row.append(statusCell);
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

        const statusButton = document.createElement("button");
        statusButton.type = "button";
        statusButton.className = "account-action-btn delete-account-btn";
        statusButton.textContent = isArchived ? "Reactivate" : "Archive";
        const cannotChangeSelf = user.id === currentUserId;
        const cannotChangeAdmin = user.role === "Admin";
        statusButton.disabled = cannotChangeSelf || cannotChangeAdmin;
        statusButton.title = cannotChangeSelf
            ? "You cannot change your own account status."
            : cannotChangeAdmin
                ? "The Admin account cannot be archived. Ask your system operator to replace it."
                : isArchived ? "Reactivate account" : "Archive account";
        statusButton.addEventListener("click", () => updateAccountStatus(user));
        actionsCell.append(statusButton);
        row.append(actionsCell);
        accountsList.append(row);
    }
    window.makeTableSortable(accountsList.closest("table"));
}

// Loads an account into the form for editing.
function startEditing(user) {
    editingUserId = user.id;
    document.getElementById("username").value = user.username;
    document.getElementById("fullName").value = user.fullName;
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

// Fetches and renders the current account list.
async function loadAccounts() {
    const data = await apiRequest("/api/admin/users");
    renderAccounts(data.users);
}

// Archives or reactivates an account after confirmation.
async function updateAccountStatus(user) {
    const isArchived = user.isActive === false;
    if (isArchived) {
        if (!window.confirm(`Reactivate the account for "${user.username}"?`)) {
            return;
        }
        try {
            const data = await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
                method: "PATCH",
                body: JSON.stringify({ isActive: true })
            });
            resetAccountForm();
            showMessage(data.message);
            await loadAccounts();
        } catch (error) {
            showMessage(error.message, true);
        }
        return;
    }

    if (!window.confirm(`Archive the account for "${user.username}"? They will be signed out and unable to sign in. You can reactivate the account later.`)) {
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

// Creates a new account or saves edits to an existing one.
accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const confirmed = window.confirm(editingUserId
        ? "Save changes to this account?"
        : "Create this Staff account?");
    if (!confirmed) {
        return;
    }
    const payload = {
        username: document.getElementById("username").value.trim(),
        fullName: document.getElementById("fullName").value.trim()
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

const recoveryCodesStatus = document.getElementById("recoveryCodesStatus");
const regenerateCodesButton = document.getElementById("regenerateCodesButton");
const copyCodesButton = document.getElementById("copyCodesButton");
const downloadCodesButton = document.getElementById("downloadCodesButton");
const recoveryCodesDisplay = document.getElementById("recoveryCodesDisplay");
const recoveryCodesList = document.getElementById("recoveryCodesList");

// Shows how many recovery codes remain.
function renderRecoveryCodesStatus(user) {
    const remaining = user.recoveryCodesRemaining;
    const total = user.recoveryCodesTotal;
    if (typeof remaining !== "number") {
        recoveryCodesStatus.textContent = "Recovery codes are unavailable.";
        return;
    }
    if (remaining === 0) {
        recoveryCodesStatus.textContent =
            "You have no recovery codes left. Generate a new set, otherwise you cannot recover this account if you forget your password.";
        return;
    }
    recoveryCodesStatus.textContent = `${remaining} of ${total} recovery codes remaining.` +
        (user.recoveryCodesLow ? " Running low - generate a new set soon." : "");
}

// Displays newly issued recovery codes once.
function showIssuedCodes(codes) {
    issuedRecoveryCodes = Array.isArray(codes) ? codes : [];
    recoveryCodesList.replaceChildren();
    for (const code of issuedRecoveryCodes) {
        const item = document.createElement("li");
        item.textContent = code;
        recoveryCodesList.append(item);
    }
    recoveryCodesDisplay.hidden = false;
    copyCodesButton.hidden = false;
    downloadCodesButton.hidden = false;
}

// Issues a fresh set of recovery codes.
async function regenerateRecoveryCodes() {
    if (!window.confirm(
        "Generate new recovery codes? Your current codes will stop working immediately."
    )) {
        return;
    }

    regenerateCodesButton.disabled = true;
    try {
        const data = await apiRequest("/api/admin/recovery-codes/regenerate", {
            method: "POST"
        });
        showIssuedCodes(data.codes);
        renderRecoveryCodesStatus(data);
        showMessage(data.message);
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        regenerateCodesButton.disabled = false;
    }
}

copyCodesButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(issuedRecoveryCodes.join("\n"));
        showMessage("Recovery codes copied to the clipboard.");
    } catch {
        showMessage("Copy failed. Select the codes and copy them manually.", true);
    }
});

// Downloads the visible recovery codes as a text file.
downloadCodesButton.addEventListener("click", () => {
    if (issuedRecoveryCodes.length === 0) {
        return;
    }
    // Built in the browser, so nothing is sent anywhere.
    const blob = new Blob([`${issuedRecoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const link = document.createElement("a");
    link.href = url;
    link.download = `possia-recovery-codes-${stamp}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage("Codes downloaded. Move the file offline and delete it from Downloads.");
});

regenerateCodesButton.addEventListener("click", regenerateRecoveryCodes);

// Verifies Admin access before revealing the page.
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
        document.getElementById("userInfo").textContent = user.fullName;
        document.getElementById("adminSettings").hidden = false;
        renderRecoveryCodesStatus(user);
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