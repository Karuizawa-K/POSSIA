(function () {
    var PREFIX = "possia.reportCache.";
    var VERSION = "v1";

    // Builds the namespaced storage key for a cached report.
    function cacheKey(name) {
        return PREFIX + name + "." + VERSION;
    }

    // Returns today's date string in the report time zone.
    function today() {
        try {
            return new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Manila",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(new Date());
        } catch (error) {
            return null;
        }
    }

    window.PossiaReportCache = {
        today: today,
        // Stores a report payload with its timestamp and day stamp.
        save: function (name, payload) {
            try {
                localStorage.setItem(cacheKey(name), JSON.stringify({
                    savedAt: Date.now(),
                    day: today(),
                    payload: payload
                }));
                return true;
            } catch (error) {
                console.warn("Report cache save skipped:", error);
                return false;
            }
        },
        // Returns a same-day payload that is still within the freshness window.
        read: function (name, maxAgeMs) {
            try {
                var raw = localStorage.getItem(cacheKey(name));
                if (!raw) {
                    return null;
                }
                var entry = JSON.parse(raw);
                if (!entry || !entry.payload || entry.day !== today()) {
                    return null;
                }
                if (typeof maxAgeMs === "number" && Date.now() - entry.savedAt > maxAgeMs) {
                    return null;
                }
                return entry.payload;
            } catch (error) {
                return null;
            }
        },
        // Deletes every cached report entry.
        clearAll: function () {
            try {
                var doomed = [];
                for (var i = 0; i < localStorage.length; i += 1) {
                    var existing = localStorage.key(i);
                    if (existing && existing.indexOf(PREFIX) === 0) {
                        doomed.push(existing);
                    }
                }
                for (var j = 0; j < doomed.length; j += 1) {
                    localStorage.removeItem(doomed[j]);
                }
            } catch (error) {
            }
        }
    };
})();