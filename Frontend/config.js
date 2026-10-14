(function () {
  var API_BASE_URL = "https://possia.onrender.com";

  // Lets local runs point at another backend without editing this file.
  try {
    var override = localStorage.getItem("possia_api_base");
    if (override && override.trim()) {
      API_BASE_URL = override.trim().replace(/\/$/, "");
    }
  } catch (error) {
  }

  window.POSSIA_CONFIG = { API_BASE_URL: API_BASE_URL };

  // Builds an absolute API URL from a path, tolerating a missing slash.
  window.apiUrl = function (path) {
    if (typeof path !== "string" || !path) {
      return API_BASE_URL;
    }
    return API_BASE_URL.replace(/\/$/, "") + (path.charAt(0) === "/" ? path : "/" + path);
  };
})();