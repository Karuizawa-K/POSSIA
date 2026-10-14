// Shared in-page sidebar: scroll-spy only.
//
// This module deliberately NEVER hides links. Visibility of sidebar links is
// owned by each page, which knows the real reason (category, role, generated
// sections). An earlier version hid links with layout heuristics
// (target.offsetParent / hidden state) via MutationObservers, which raced with
// the page that owned them and made links flash and disappear.
(function () {
    document.documentElement.classList.add("sidebar-smooth");
    const links = Array.from(document.querySelectorAll(".page-sidebar a[href^='#']"));
    if (links.length === 0) {
        return;
    }

    // anchor id -> link, so late-created sections can be tracked as well.
    const linkByAnchor = new Map();
    for (const link of links) {
        linkByAnchor.set(link.getAttribute("href").slice(1), link);
    }

    let scrollObserver = null;
    if ("IntersectionObserver" in window) {
        scrollObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    for (const link of links) {
                        link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
                    }
                }
            }
        }, { rootMargin: "-30% 0px -60% 0px" });
    }

    const observed = new Set();
    function observeExisting() {
        for (const [anchor, link] of linkByAnchor) {
            const target = document.getElementById(anchor);
            // Observing never changes visibility; it only feeds the active state.
            if (target && !observed.has(target)) {
                observed.add(target);
                scrollObserver?.observe(target);
            }
        }
    }

    // Sections created after load (stacked report views) notify us explicitly;
    // the observer is a fallback for any other dynamically added section.
    window.addEventListener("page-sections-changed", observeExisting);
    if ("MutationObserver" in window) {
        let scheduled = false;
        const structureObserver = new MutationObserver(() => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                observeExisting();
            }, 50);
        });
        structureObserver.observe(document.body, { childList: true, subtree: true });
    }
    observeExisting();
})();