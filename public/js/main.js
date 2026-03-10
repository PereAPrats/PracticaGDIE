function cargarComponente(id, archivo) {
    fetch(archivo)
        .then(response => {
            if (!response.ok) throw new Error("Error al cargar " + archivo);
            return response.text();
        })
        .then(data => {
            document.getElementById(id).innerHTML = data;
        })
        .catch(error => console.error(error));
}

document.addEventListener("DOMContentLoaded", () => {
    cargarComponente('header-placeholder', 'partials/header.html');
    cargarComponente('footer-placeholder', 'partials/footer.html');
});
