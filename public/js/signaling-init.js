/**
 * signaling-init.js - Inicialización de Socket.IO para señalización WebRTC
 * Gestiona la conexión con el servidor de signaling y los eventos de la sala
 */

(function () {
    // Extraer parámetros de URL
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user') || 'user_' + Math.random().toString(36).substr(2, 9);
    const roomId = params.get('room') || 'room1';

    // Mostrar userId en la página
    const userDisplay = document.getElementById('userIdDisplay');
    if (userDisplay) {
        userDisplay.textContent = userId;
    }

    // Guardar globalmente
    window.userId = userId;
    window.roomId = roomId;

    console.log(`[SIGNALING] Inicializando con userId=${userId}, roomId=${roomId}`);

    // Esperar a que Socket.IO esté disponible
    if (typeof io !== 'undefined') {
        const socket = io();
        window.socket = socket;

        socket.on('connect', () => {
            console.log('[SIGNALING] Conectado a servidor. Socket ID:', socket.id);
            // Unirse a la sala
            socket.emit('join-room', roomId, userId);
        });

        socket.on('users-in-room', (users) => {
            console.log('[SIGNALING] Usuarios en sala:', users);
            // Disparar evento personalizado para que otros scripts lo escuchen
            window.dispatchEvent(new CustomEvent('usersInRoom', { detail: { users } }));
        });

        socket.on('user-joined', (data) => {
            console.log('[SIGNALING] Usuario se unió:', data.userId);
            window.dispatchEvent(new CustomEvent('userJoined', { detail: data }));
        });

        socket.on('receive-offer', (data) => {
            console.log('[SIGNALING] Oferta recibida de:', data.from);
            window.dispatchEvent(new CustomEvent('receiveOffer', { detail: data }));
        });

        socket.on('receive-answer', (data) => {
            console.log('[SIGNALING] Respuesta recibida de:', data.from);
            window.dispatchEvent(new CustomEvent('receiveAnswer', { detail: data }));
        });

        socket.on('receive-ice-candidate', (data) => {
            console.log('[SIGNALING] ICE candidate recibido de:', data.from);
            window.dispatchEvent(new CustomEvent('receiveIceCandidate', { detail: data }));
        });

        socket.on('receive-question', (data) => {
            console.log('[QUIZ] Pregunta recibida de:', data.from);
            window.dispatchEvent(new CustomEvent('receiveQuestion', { detail: data }));
        });

        socket.on('receive-answer', (data) => {
            console.log('[QUIZ] Respuesta recibida de:', data.from);
            window.dispatchEvent(new CustomEvent('receiveAnswer', { detail: data }));
        });

        socket.on('user-left', (data) => {
            console.log('[SIGNALING] Usuario desconectado:', data.userId);
            window.dispatchEvent(new CustomEvent('userLeft', { detail: data }));
        });

        socket.on('my-connection-count', (data) => {
            console.log(`[SIGNALING] Mis conexiones: ${data.count}`);
            window.dispatchEvent(new CustomEvent('my-connection-count', { detail: data }));
        });

        socket.on('my-connection-count-changed', (data) => {
            console.log(`[SIGNALING] Cambio en conexiones de ${data.userId}: ${data.count}`);
            window.dispatchEvent(new CustomEvent('my-connection-count-changed', { detail: data }));
        });

        socket.on('disconnect', () => {
            console.log('[SIGNALING] Desconectado del servidor');
            window.dispatchEvent(new CustomEvent('signalingDisconnect'));
        });

    } else {
        console.warn('[SIGNALING] Socket.IO no cargado');
    }
})();
