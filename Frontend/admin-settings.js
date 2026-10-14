// apiUrl() is defined in config.js (loaded before this file) and prefixes
// paths with the Render backend URL. Fall back to same-origin when missing.
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

function showMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error-message", isError);
}

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
        const cannotDeleteSelf = user.id === currentUserId;
        const cannotDeleteAdmin = user.role === "Admin";
        deleteButton.disabled = cannotDeleteSelf || cannotDeleteAdmin;
        deleteButton.title = cannotDeleteSelf
            ? "You cannot delete your own account."
            : cannotDeleteAdmin
                ? "The Admin account cannot be deleted. Ask your system operator to replace it."
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
    const data = await apiRequest("/api/admin/users");
    renderAccounts(data.users);
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