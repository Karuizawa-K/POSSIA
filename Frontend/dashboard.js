// Loads the signed in user and fetches user role
// apiUrl() is defined in config.js (loaded before this file).
const apiUrl = window.apiUrl || ((path) => path);
async function loadSession() {
    try {
        const token = localStorage.getItem("token");
        if (!token) {
            window.location.replace("/");
            return null;
        }

        const response = await fetch(apiUrl("/api/profile"), {
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

        document.getElementById("userInfo").textContent = data.user.fullName;
        const isAdmin = data.user.role === "Admin";
        document.getElementById("dashboardTitle").textContent =
            isAdmin ? "Admin Dashboard" : "Dashboard";
        document.getElementById("reportsButton").hidden = !isAdmin;
        document.querySelector(".cards-wrapper").classList.toggle("staff-view", !isAdmin);
        if (isAdmin) {
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

    // Warm today's sales report so the Reports tab paints instantly instead of
    // waiting on a round-trip. Fire-and-forget: failures are ignored because
    // the Reports page fetches on its own. Raw fetch (not the page apiRequest)
    // so a failure can never trigger a redirect.
    async function prefetchTodaysSalesReport() {
        const cache = window.PossiaReportCache;
        const day = cache?.today();
        const token = localStorage.getItem("token");
        if (!cache || !day || !token) {
            return;
        }
        try {
            const response = await fetch(
                apiUrl(`/api/admin/reports/sales?period=daily&date=${encodeURIComponent(day)}`),
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!response.ok) {
                return;
            }
            cache.save("sales", await response.json());
        } catch (error) {
            console.warn("Unable to preload today's sales report:", error);
        }
    }

    sessionPromise.then((role) => {
        // Reports is Admin-only, so Staff never trigger the preload.
        if (role === "Admin") {
            prefetchTodaysSalesReport();
        }
    });

    // Staff restriction logic for dashboard
    document.querySelectorAll(".cards-wrapper [data-page]")
        .forEach((button) => {
            button.addEventListener("click", async () => {
                const role = await sessionPromise;
                if (!role) {
                    return;
                }

                const page = button.dataset.page;
                const restrictedPages = ["reports.html"];

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
            window.PossiaReportCache?.clearAll();
            window.location.replace("/");
        });
    //========================
