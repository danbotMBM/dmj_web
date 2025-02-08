function import_html(path_to_html, id_to_insert){
    fetch(path_to_html)
        .then(response => response.text())
        .then(data => {
            document.getElementById(id_to_insert).innerHTML = data;
        });
}
export default import_html