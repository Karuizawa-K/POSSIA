// POSSIA frontend configuration (Vercel).
// Single place to point the static UI at the Render backend API.
// Update API_BASE_URL when the backend URL changes; no trailing slash.
(function () {
  var API_BASE_URL = "https://possia.onrender.com";

  // Allow override without editing this file (e.g. local dev, previews):
  //   localStorage.setItem("possia_api_base", "http://localhost:5000")
  try {
    var override = localStorage.getItem("possia_api_base");
    if (override && override.trim()) {
      API_BASE_URL = override.trim().replace(/\/$/, "");
    }
  } catch (error) {
    // localStorage may be unavailable; fall back to the committed URL.
  }

  window.POSSIA_CONFIG = { API_BASE_URL: API_BASE_URL };
  window.apiUrl = function (path) {
    if (typeof path !== "string" || !path) {
      return API_BASE_URL;
    }
    return API_BASE_URL.replace(/\/$/, "") + (path.charAt(0) === "/" ? path : "/" + path);
  };
})();
