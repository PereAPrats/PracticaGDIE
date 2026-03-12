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
    // index.html (o raíz) ahora usa la carpeta html/partials
    if (path === '/' || path === '/index.html') {
        ruta = 'html/partials/';
    } else if (path.includes('/html/')) {
        // una página dentro de /html
        ruta = 'partials/';
    } else {
        // caso genérico, por seguridad
        ruta = 'html/partials/';
    }
    cargarComponente('header-placeholder', ruta + 'header.html');
    cargarComponente('footer-placeholder', ruta + 'footer.html');
});
