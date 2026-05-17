/**
 * qr-modal.js - Generación dinámica de códigos QR para salas de signaling
 * Crea un QR que codifica la URL de la sala para que otros usuarios se unan
 */

(function () {
    const modal = document.getElementById('qrModal');
    const openBtn = document.getElementById('openQrModal');
    const closeBtn = document.getElementById('closeQrModal');

    if (!modal || !openBtn || !closeBtn) {
        console.warn('[QR] Elementos del modal QR no encontrados en el DOM');
        return;
    }

    let qrGenerated = false;

    function generateQR() {
        // Solo generar una vez
        if (qrGenerated) return;

        const qrContainer = document.getElementById('qrCode');
        const qrUrlDisplay = document.getElementById('qrUrl');
        const roomNameDisplay = document.getElementById('qrRoomName');

        if (!qrContainer) {
            console.warn('[QR] Contenedor QR no encontrado');
            return;
        }

        // Limpiar contenedor
        qrContainer.innerHTML = '';

        // Construir URL para que otros se unan a la sala
        const protocol = window.location.protocol;
        const host = window.location.host;
        const joinUrl = `${protocol}//${host}/html/practica3.html?room=${window.roomId}`;

        // Mostrar room name
        if (roomNameDisplay) {
            roomNameDisplay.textContent = window.roomId;
        }

        // Mostrar URL
        if (qrUrlDisplay) {
            qrUrlDisplay.textContent = joinUrl;
        }

        // Generar QR con QRCode.js
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(qrContainer, {
                    text: joinUrl,
                    width: 250,
                    height: 250,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                console.log('[QR] Código QR generado para sala:', window.roomId);
                qrGenerated = true;
            } catch (error) {
                console.error('[QR] Error generando QR:', error);
                qrContainer.textContent = 'Error generando QR';
            }
        } else {
            console.warn('[QR] Librería QRCode no disponible');
            qrContainer.textContent = 'QRCode no cargado';
        }
    }

    function openModal() {
        generateQR(); // Generar QR cuando se abre
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        console.log('[QR] Modal abierto para sala:', window.roomId);
    }

    function closeModal() {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && modal.classList.contains('is-open')) {
            closeModal();
        }
    });

    console.log('[QR] Sistema de QR modal inicializado');
})();
