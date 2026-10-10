// Loads the signed in user and fetches user role
async function loadSession() {
        try {
            const response = await fetch("/api/session");

            if (!response.ok) {
                window.location.replace("/");
                return;
            }

            const data = await response.json();

            document.getElementById("userInfo").textContent =
                `${data.user.email} (${data.user.role})`;
            return data.user.role;

        } catch (error) {
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

    // Logout button logic
    document.getElementById("logoutButton")
        .addEventListener("click", async () => {
            try {
                const response = await fetch("/api/logout", {
                    method: "POST"
                });

                if (response.ok) {
                    window.location.replace("/");
                }
            } catch (error) {
                alert("Unable to log out. Please try again.");
            }
        });
    //========================
