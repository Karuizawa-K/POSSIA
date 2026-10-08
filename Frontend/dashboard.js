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

        } catch (error) {
            window.location.replace("/");
        }
    }

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

    loadSession();