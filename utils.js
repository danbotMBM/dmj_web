// API base URL - change for dev/prod
const API_BASE = (() => {
    const host = location.hostname;
    if (host === 'danbotlab.com' || host.endsWith('.danbotlab.com')) return 'https://api.danbotlab.com';
    if (host === 'danielmarkjones.com' || host.endsWith('.danielmarkjones.com')) return 'https://api.danielmarkjones.com';
    return 'https://api.danbotlab';
})();

function import_html(path_to_html, id_to_insert) {
    fetch(path_to_html)
        .then(response => response.text())
        .then(data => {
            const target = document.getElementById(id_to_insert);
            target.innerHTML = data;
            mark_active_nav(target);
        });
}

function import_htmls(paths_to_html, id_to_insert) {
    Promise.all(paths_to_html.map(path => fetch(path).then(response => response.text())))
        .then(htmlContents => {
            const container = document.getElementById(id_to_insert);
            container.innerHTML = htmlContents.join("");
            wrap_feature_cards(container);
        })
        .catch(error => console.error("Error loading HTML files:", error));
}

function wrap_feature_cards(container) {
    const headings = Array.from(container.querySelectorAll("h2"));
    headings.forEach(h2 => {
        const link = h2.querySelector("a");
        if (!link) return;
        const href = link.getAttribute("href");
        const title = link.textContent;

        const titleSpan = document.createElement("span");
        titleSpan.textContent = title;
        link.replaceWith(titleSpan);

        const card = document.createElement("a");
        card.className = "feature-card";
        card.href = href;

        const parent = h2.parentNode;
        const next = h2.nextElementSibling;
        parent.insertBefore(card, h2);
        card.appendChild(h2);
        if (next && (next.tagName === "UL" || next.tagName === "OL" || next.tagName === "P")) {
            card.appendChild(next);
        }
    });

    // Group all top-level feature-cards into a responsive grid
    const cards = Array.from(container.children).filter(el => el.classList && el.classList.contains("feature-card"));
    if (cards.length > 0) {
        const grid = document.createElement("div");
        grid.className = "feature-grid";
        container.insertBefore(grid, cards[0]);
        cards.forEach(card => grid.appendChild(card));
    }
}

function mark_active_nav(container) {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    container.querySelectorAll("a.navlink").forEach(link => {
        const href = link.getAttribute("href").replace(/\/$/, "") || "/";
        if (href === path) {
            link.classList.add("is-active");
        }
    });
}

export { import_html, import_htmls, API_BASE }
