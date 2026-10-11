// =========================
// LOGIN
// =========================

const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("togglePassword");
const recoveryForm = document.getElementById("recoveryForm");
const recoveryCodeInput = document.getElementById("recoveryCode");
const newPasswordInput = document.getElementById("newPassword");

function wirePasswordToggle(input, button) {
    button.addEventListener("click", () => {
        const isPasswordHidden = input.type === "password";
        input.type = isPasswordHidden ? "text" : "password";
        button.textContent = isPasswordHidden ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(isPasswordHidden));
    });
}

wirePasswordToggle(passwordInput, togglePasswordButton);
wirePasswordToggle(recoveryCodeInput, document.getElementById("toggleRecoveryCode"));
wirePasswordToggle(newPasswordInput, document.getElementById("toggleNewPassword"));

document.getElementById("showRecoveryForm").addEventListener("click", () => {
    document.getElementById("message").textContent = "";
    loginForm.classList.add("hidden");
    document.getElementById("showRecoveryForm").classList.add("hidden");
    recoveryForm.classList.remove("hidden");
    document.getElementById("recoveryUsername").value =
        document.getElementById("username").value.trim();
    document.getElementById("recoveryUsername").focus();
});

document.getElementById("cancelRecovery").addEventListener("click", () => {
    recoveryForm.reset();
    document.getElementById("recoveryMessage").textContent = "";
    recoveryForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    document.getElementById("showRecoveryForm").classList.remove("hidden");
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = passwordInput.value;
    const message = document.getElementById("message");

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            message.textContent = data.message;
            return;
        }

        // Save JWT token
        localStorage.setItem("token", data.token);

        // Go to dashboard
        window.location.href = "dashboard.html";

    } catch (error) {
        message.textContent = "Unable to connect to the server.";
        console.error(error);
    }
});

recoveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("recoveryMessage");
    if (newPasswordInput.value !== document.getElementById("confirmNewPassword").value) {
        message.textContent = "The new passwords do not match.";
        return;
    }

    try {
        const response = await fetch("/api/owner/password-recovery", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: document.getElementById("recoveryUsername").value.trim(),
                recoveryCode: recoveryCodeInput.value,
                newPassword: newPasswordInput.value,
                confirmPassword: document.getElementById("confirmNewPassword").value
            })
        });

        const data = await response.json();
        message.textContent = data.message || (
            response.ok ? "Password reset successfully." : "Unable to reset the password."
        );
        if (response.ok) {
            recoveryForm.reset();
        }
    } catch (error) {
        message.textContent = "Unable to connect to the server.";
        console.error(error);
    }
});