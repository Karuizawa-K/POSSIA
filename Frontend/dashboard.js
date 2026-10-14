const apiUrl = window.apiUrl || ((path) => path);

// Loads the signed-in profile and applies role-based page state.
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

const sessionPromise = loadSession();

// Warms today's sales report so the Reports tab paints without waiting.
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
    if (role === "Admin") {
        prefetchTodaysSalesReport();
    }
});

// Routes each workspace card, blocking pages the role cannot open.
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

document.getElementById("adminSettingsButton")
    .addEventListener("click", () => {
        window.location.href = "admin-settings.html";
    });

// Signs the user out and clears the cached report payload.
document.getElementById("logoutButton")
    .addEventListener("click", () => {
        localStorage.removeItem("token");
        window.PossiaReportCache?.clearAll();
        window.location.replace("/");
    });