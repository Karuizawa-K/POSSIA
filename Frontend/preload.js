// Shared cache for preloaded report payloads.
//
// The dashboard warms "today's sales" so the Reports tab can paint its
// default view immediately instead of waiting on a round-trip. Loaded by
// dashboard.html and reports.html.
//
// Entries are namespaced, day-scoped and age-scoped, so a stale or leftover
// entry can never be served. Every operation is best-effort: private mode or a
// full quota just means the Reports page falls back to fetching normally.
(function () {
    var PREFIX = "possia.reportCache.";
    var VERSION = "v1";

    function cacheKey(name) {
        return PREFIX + name + "." + VERSION;
    }

    // Same calendar day the backend groups sales by (Asia/Manila).
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
        // Returns the payload only when it belongs to today and is fresh
        // enough to paint with; otherwise null so the caller fetches.
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
                // Nothing to do; entries are already day/age scoped.
            }
        }
    };
})();