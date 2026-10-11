// Loads the signed in user and fetches user role
async function loadSession() {
    try {
        const token = localStorage.getItem("token");
        if (!token) {
            window.location.replace("/");
            return null;
        }

        const response = await fetch("/api/profile", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            localStorage.removeItem("token");
            window.location.replace("/");
            return null;
        }

        const data = await response.json();

        document.getElementById("userInfo").textContent =
            `${data.user.fullName} (@${data.user.username})`;
        if (data.user.role === "Admin") {
            document.getElementById("adminSettingsButton").hidden = false;
        }
        return data.user.role;
    } catch (error) {
        console.error("Unable to load user session:", error);
        window.location.replace("/");
        return null;
    }
}
    //========================

    const sessionPromise = loadSession();

    // Staff restriction logic for dashboard
    document.querySelectorAll(".cards-wrapper [data-page]")
        .forEach((button) => {
            button.addEventListener("click", async () => {
                const role = await sessionPromise;
                if (!role) {
                    return;
                }

                const page = button.dataset.page;
                const restrictedPages = ["inventory.html", "reports.html"];

                if (
                    role.toLowerCase() === "staff" &&
                    restrictedPages.includes(page)
                ) {
                    alert("Sorry, You do not have permission for this action.");
                    return;
                }

                window.location.href = page;
            });
        });
    //========================

    document.getElementById("adminSettingsButton")
        .addEventListener("click", () => {
            window.location.href = "admin-settings.html";
        });
    //========================

    // Logout button logic
    document.getElementById("logoutButton")
        .addEventListener("click", () => {
            localStorage.removeItem("token");
            window.location.replace("/");
        });
    //========================
