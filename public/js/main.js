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
    let ruta;
    const path = window.location.pathname;
    // index.html (o raíz) ahora usa la carpeta pages/partials
    if (path === '/' || path === '/index.html') {
        ruta = 'pages/partials/';
    } else if (path.includes('/pages/')) {
        // una página dentro de /pages
        ruta = 'partials/';
    } else {
        // caso genérico, por seguridad
        ruta = 'pages/partials/';
    }
    cargarComponente('header-placeholder', ruta + 'header.html');
    cargarComponente('footer-placeholder', ruta + 'footer.html');
});
