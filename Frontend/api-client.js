(function () {
  // Sends an authenticated API request and throws the server message on failure.
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
        logout();
      }
      throw new Error(data.message || "Request failed.");
    }
    return data;
  }

  // Clears the stored session token and returns to the login page.
  function logout(options = {}) {
    localStorage.removeItem("token");
    if (options.clearReportCache) {
      window.PossiaReportCache?.clearAll();
    }
    window.location.replace("/");
  }

  // Sends a visitor without a session back to the login page.
  function redirectToLogin() {
    window.location.replace("/");
  }

  // Sends an authenticated visitor back to the dashboard.
  function redirectToDashboard() {
    window.location.replace("dashboard.html");
  }

  window.apiRequest = apiRequest;
  window.logout = logout;
  window.redirectToLogin = redirectToLogin;
  window.redirectToDashboard = redirectToDashboard;
})();