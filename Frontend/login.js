// =========================
// LOGIN
// =========================

const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("togglePassword");

togglePasswordButton.addEventListener("click", () => {
    const isPasswordHidden = passwordInput.type === "password";
    passwordInput.type = isPasswordHidden ? "text" : "password";
    togglePasswordButton.textContent = isPasswordHidden ? "Hide" : "Show";
    togglePasswordButton.setAttribute("aria-pressed", String(isPasswordHidden));
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