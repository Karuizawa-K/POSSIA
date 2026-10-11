const accountForm = document.getElementById("accountForm");
const accountsList = document.getElementById("accountsList");
const statusMessage = document.getElementById("statusMessage");
const passwordInput = document.getElementById("password");
const formHeading = document.getElementById("formHeading");
const saveAccountButton = document.getElementById("saveAccountButton");
const cancelEditButton = document.getElementById("cancelEditButton");
const roleInput = document.getElementById("role");
const ownershipTransferForm = document.getElementById("ownershipTransferForm");
const ownershipTransferSection = document.getElementById("ownershipTransferSection");
const ownershipTarget = document.getElementById("ownershipTarget");
const ownerPasswordInput = document.getElementById("ownerPassword");
const ownershipNotice = document.getElementById("ownershipNotice");

let currentUserId;
let editingUserId = null;
let currentUserIsOwner = false;

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
    roleInput.disabled = false;
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
        for (const [index, value] of [user.username, user.fullName, user.role].entries()) {
            const cell = document.createElement("td");
            cell.textContent = user.isOwner && index === 2
                ? "Admin (System Owner)"
                : value;
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
        editButton.disabled = user.isOwner && !currentUserIsOwner;
        editButton.title = editButton.disabled
            ? "Only the system owner can edit the owner account."
            : "Edit account";
        editButton.addEventListener("click", () => startEditing(user));
        actionsCell.append(editButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "account-action-btn delete-account-btn";
        deleteButton.textContent = "Delete";
        const cannotDeleteSelf = user.id === currentUserId;
        const cannotDeleteAdmin = user.role === "Admin" && !currentUserIsOwner;
        const cannotDeleteOwner = user.isOwner;
        deleteButton.disabled = cannotDeleteSelf || cannotDeleteAdmin || cannotDeleteOwner;
        deleteButton.title = cannotDeleteSelf
            ? "You cannot delete your own account."
            : cannotDeleteOwner
                ? "Transfer ownership before deleting the owner account."
                : cannotDeleteAdmin
                    ? "Only the system owner can delete another Admin account."
                    : "Delete account";
        deleteButton.addEventListener("click", () => deleteAccount(user));
        actionsCell.append(deleteButton);
        row.append(actionsCell);
        accountsList.append(row);
    }
    window.makeTableSortable(accountsList.closest("table"));

    ownershipTarget.replaceChildren();
    for (const user of users.filter((account) =>
        account.role === "Admin" && account.id !== currentUserId
    )) {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = `${user.fullName} (@${user.username})`;
        ownershipTarget.append(option);
    }
    ownershipTarget.disabled = ownershipTarget.options.length === 0;
    ownershipTransferForm.querySelector("button[type='submit']").disabled =
        ownershipTarget.disabled;
}

function startEditing(user) {
    editingUserId = user.id;
    document.getElementById("username").value = user.username;
    document.getElementById("fullName").value = user.fullName;
    roleInput.value = user.role;
    roleInput.disabled = user.role === "Admin" && !currentUserIsOwner;
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
    currentUserIsOwner = data.currentUserIsOwner;
    ownershipTransferSection.hidden = !currentUserIsOwner;
    ownershipNotice.hidden = data.ownerConfigured && currentUserIsOwner;
    ownershipNotice.textContent = !data.ownerConfigured
        ? data.ownerConfigurationInvalid
            ? "The configured system owner is missing or is not an Admin. Contact a trusted system operator for recovery; ownership was not reassigned."
            : "System ownership has not been initialized. Run npm run migrate:owner in Backend before using owner-only account controls."
        : currentUserIsOwner
            ? ""
            : "Only the system owner can delete or demote Admin accounts, or transfer ownership.";
    renderAccounts(data.users);
}

ownershipTransferForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedOption = ownershipTarget.selectedOptions[0];
    if (!selectedOption) {
        showMessage("Create or select another Admin account before transferring ownership.", true);
        return;
    }
    if (!window.confirm(
        `Transfer system ownership to ${selectedOption.textContent}? You will immediately lose owner-only privileges.`
    )) {
        return;
    }

    const submitButton = ownershipTransferForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    try {
        const result = await apiRequest("/api/admin/owner-transfer", {
            method: "POST",
            body: JSON.stringify({
                targetUserId: ownershipTarget.value,
                password: ownerPasswordInput.value,
                confirmTransfer: true
            })
        });
        ownerPasswordInput.value = "";
        showMessage(result.message);
        await loadAccounts();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        submitButton.disabled = ownershipTarget.disabled;
    }
});

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
