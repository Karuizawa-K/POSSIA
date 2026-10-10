const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");

// Show password 
togglePassword.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    togglePassword.textContent = isVisible ? "Show" : "Hide";
    togglePassword.setAttribute("aria-pressed", String(!isVisible));
});
//========================

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    message.textContent = "Logging in...";

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            message.textContent = data.message;
            return;
        }

        window.location.href = data.redirect;

    } catch (error) {
        message.textContent =
            "Unable to connect to the server.";
    }
});