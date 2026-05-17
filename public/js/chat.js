/**
 * chat.js - Sistema de chat en tiempo real con Socket.IO
 * Maneja envío de mensajes, notificaciones de usuarios conectados/desconectados
 */

(function () {
    const chatMessagesDiv = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendMsgBtn = document.getElementById('sendMsgBtn');
    const chatUsersCount = document.getElementById('chatUsersCount');
    const otherMessageClasses = [
        'chat-message-other-1',
        'chat-message-other-2',
        'chat-message-other-3',
        'chat-message-other-4',
        'chat-message-other-5'
    ];
    let otherMessageClassIndex = 0;

    if (!chatMessagesDiv || !chatInput || !sendMsgBtn) {
        console.warn('[CHAT] Elementos del chat no encontrados en el DOM');
        return;
    }

    let connectedUsersCount = 1;

    function updateUsersCount(count) {
        connectedUsersCount = Math.max(1, count);

        if (!chatUsersCount) return;

        chatUsersCount.textContent = connectedUsersCount === 1
            ? '1 conectado'
            : `${connectedUsersCount} conectados`;
    }

    /**
     * Agrega un mensaje al chat
     */
    function addMessageToChat(userName, message, options = {}) {
        const { isSystem = false, senderId = null } = options;
        const messageDiv = document.createElement('div');
        if (isSystem) {
            messageDiv.className = 'chat-message-system';
        } else if (senderId && senderId === window.userId) {
            messageDiv.className = 'chat-message chat-message-own';
        } else {
            const toneClass = otherMessageClasses[otherMessageClassIndex % otherMessageClasses.length];
            otherMessageClassIndex += 1;
            messageDiv.className = `chat-message ${toneClass}`;
        }
        
        if (isSystem) {
            messageDiv.innerHTML = `<small style="color: #999; font-style: italic;">${message}</small>`;
        } else {
            messageDiv.innerHTML = `<strong>${userName}:</strong> ${escapeHtml(message)}`;
        }
        
        chatMessagesDiv.appendChild(messageDiv);
        // Auto-scroll al final
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }

    /**
     * Escapa caracteres HTML para evitar inyecciones
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Envía un mensaje al servidor
     */
    function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        if (window.socket) {
            window.socket.emit('send-chat-message', {
                userId: window.userId,
                message: message,
                roomId: window.roomId,
                timestamp: new Date().toISOString()
            });
        }

        chatInput.value = '';
        chatInput.focus();
    }

    // Evento para enviar mensaje al presionar Enter
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Evento para enviar mensaje con el botón
    sendMsgBtn.addEventListener('click', sendMessage);

    // Escuchar mensajes del servidor
    if (window.socket) {
        window.socket.on('users-in-room', (users) => {
            updateUsersCount((users ? users.length : 0) + 1);
        });

        window.socket.on('receive-chat-message', (data) => {
            console.log('[CHAT] Mensaje recibido de', data.userId, ':', data.message);
            addMessageToChat(data.userId, data.message, { senderId: data.userId });
        });

        // Notificación cuando un usuario se une
        window.addEventListener('userJoined', (e) => {
            const userId = e.detail.userId;
            console.log('[CHAT] Usuario conectado:', userId);
            updateUsersCount(connectedUsersCount + 1);
            addMessageToChat(
                'SISTEMA',
                `${userId} se unió a la sala`,
                { isSystem: true }
            );
        });

        // Notificación cuando un usuario se desconecta
        window.addEventListener('userLeft', (e) => {
            const userId = e.detail.userId;
            console.log('[CHAT] Usuario desconectado:', userId);
            updateUsersCount(connectedUsersCount - 1);
            addMessageToChat(
                'SISTEMA',
                `${userId} salió de la sala`,
                { isSystem: true }
            );
        });

        updateUsersCount(1);
    } else {
        console.warn('[CHAT] Socket.IO no disponible');
    }

    console.log('[CHAT] Sistema de chat inicializado');
})();
