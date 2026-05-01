// API base URL - change for dev/prod
const API_BASE = 'https://api.danbotlab';

function import_html(path_to_html, id_to_insert) {
    fetch(path_to_html)
        .then(response => response.text())
        .then(data => {
            document.getElementById(id_to_insert).innerHTML = data;
        });
}
function import_htmls(paths_to_html, id_to_insert) {
    Promise.all(paths_to_html.map(path => fetch(path).then(response => response.text())))
        .then(htmlContents => {
            const container = document.getElementById(id_to_insert);
            container.innerHTML = htmlContents.join(""); // Join all HTML data
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

        // Replace the heading's anchor with a plain title span
        const titleSpan = document.createElement("span");
        titleSpan.textContent = title;
        link.replaceWith(titleSpan);

        // Build the clickable card and absorb the h2 + immediately-following ul/p siblings
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
}


export { import_html, import_htmls, API_BASE }