function import_html(html, loc){
    fetch(html)
        .then(response => response.text())
        .then(data => {
            document.getElementById(loc).innerHTML = data;
        });
}
export default import_html