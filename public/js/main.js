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
    // si estamos dentro de /pages/ necesitamos subir un nivel
    const prefix = window.location.pathname.includes('/pages/') ? '../' : '';
    cargarComponente('header-placeholder', prefix + 'partials/header.html');
    cargarComponente('footer-placeholder', prefix + 'partials/footer.html');
});
