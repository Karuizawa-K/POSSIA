// Shared in-page sidebar: highlights the link for the section in view and
// hides links whose target section is hidden (e.g. Admin-only sections).
(function () {
    document.documentElement.classList.add("sidebar-smooth");
    const links = Array.from(document.querySelectorAll(".page-sidebar a[href^='#']"));
    if (links.length === 0) {
        return;
    }
    const targets = new Map();
    let scrollObserver = null;
    let visibilityObserver = null;

    function refreshVisibility() {
        for (const link of links) {
            const target = targets.get(link);
            // Links with no matching section stay hidden (e.g. report views
            // of the inactive category, which are created on Generate).
            link.hidden = !target || Boolean(target.hidden) || target.offsetParent === null;
        }
    }

    function observeTarget(target) {
        scrollObserver?.observe(target);
        visibilityObserver?.observe(target, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
    }

    function wireLinks() {
        for (const link of links) {
            if (targets.has(link)) {
                continue;
            }
            const target = document.querySelector(link.getAttribute("href"));
            if (target) {
                targets.set(link, target);
                observeTarget(target);
            }
        }
        refreshVisibility();
    }

    if ("IntersectionObserver" in window) {
        scrollObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    for (const [link, target] of targets) {
                        link.classList.toggle("active", target === entry.target);
                    }
                }
            }
        }, { rootMargin: "-30% 0px -60% 0px" });
    }

    if ("MutationObserver" in window) {
        visibilityObserver = new MutationObserver(refreshVisibility);
        for (const target of targets.values()) {
            observeTarget(target);
        }
        // Sections added later (stacked report views) get wired on arrival.
        let scheduled = false;
        const structureObserver = new MutationObserver(() => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                wireLinks();
            }, 50);
        });
        structureObserver.observe(document.body, { childList: true, subtree: true });
    }
    // Pages with dynamically generated sections (stacked reports) notify us
    // explicitly, since unhiding an ancestor never fires per-target observers.
    window.addEventListener("page-sections-changed", wireLinks);
    wireLinks();
})();
