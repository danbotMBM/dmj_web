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
            document.getElementById(id_to_insert).innerHTML = htmlContents.join(""); // Join all HTML data
        })
        .catch(error => console.error("Error loading HTML files:", error));
}


export { import_html, import_htmls }