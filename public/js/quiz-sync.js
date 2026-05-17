/**
 * quiz-sync.js - Sincronización OPCIONAL de preguntas entre dos dispositivos
 * Solo se activa si el QR está abierto Y hay dos usuarios en la sala
 * Si se cierra el QR o solo hay 1 usuario, el video se reproduce normalmente
 */

class QuizSync {
    constructor() {
        this.isHost = false;
        this.isEnabled = false; // Solo activo si QR está abierto y tengo 2+ conexiones
        this.currentQuestion = null;
        this.quizQuestions = [];
        this.isWaitingForAnswer = false;
        this.videoElement = null;
        this.dataChannel = null;
        this.socket = window.socket;
        this.myConnectionCount = 1; // Mis propias conexiones (dispositivos del mismo usuario)

        this.setupListeners();
        this.monitorQRModal();
    }

    /**
     * Monitorea si el modal QR está abierto
     */
    monitorQRModal() {
        const modalElement = document.getElementById('qrModal');
        if (!modalElement) return;

        // Usar MutationObserver para detectar cambios en el modal
        const observer = new MutationObserver(() => {
            const isOpen = modalElement.classList.contains('is-open');
            console.log(`[QUIZ] Modal QR: ${isOpen ? 'ABIERTO' : 'CERRADO'}`);
            
            if (isOpen && this.myConnectionCount >= 2) {
                // QR se abrió Y tengo 2+ conexiones → ACTIVAR
                this.enable();
            } else if (!isOpen) {
                // QR se cerró → DESACTIVAR
                this.disable();
            }
        });

        observer.observe(modalElement, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }

    /**
     * Activa el sistema de sincronización SOLO si:
     * - QR está ABIERTO
     * - Tengo 2+ conexiones (dispositivos)
     */
    enable() {
        // Validar condiciones
        const modalElement = document.getElementById('qrModal');
        const isQROpen = modalElement && modalElement.classList.contains('is-open');
        
        if (!isQROpen || this.myConnectionCount < 2) {
            console.log(`[QUIZ] No se puede activar: QROpen=${isQROpen}, MyConnections=${this.myConnectionCount}`);
            return;
        }
        
        if (this.isEnabled) return;
        
        this.isEnabled = true;
        console.log('[QUIZ] Sistema ACTIVADO - Sincronización de preguntas ACTIVA');
        
        if (this.isHost) {
            this.loadQuestionsFromVTT();
            this.setupVideoListener();
        }
    }

    /**
     * Desactiva el sistema de sincronización
     */
    disable() {
        this.isEnabled = false;
        console.log('[QUIZ] Sistema DESACTIVADO - Video con preguntas del VTT NORMAL');
        
        this.isWaitingForAnswer = false;
        this.currentQuestion = null;
    }

    /**
     * Inicializa el host (quien abrió el QR con el video)
     */
    initAsHost() {
        this.isHost = true;
        console.log('[QUIZ] Inicializado como HOST (video)');
        // No cargamos preguntas hasta que se active
    }

    /**
     * Inicializa el cliente (quien escanea el QR)
     */
    initAsClient() {
        this.isHost = false;
        console.log('[QUIZ] Inicializado como CLIENT (respuestas)');
        this.setupQuestionDisplay();
    }

    /**
     * Carga las preguntas del archivo VTT de metadatos
     */
    async loadQuestionsFromVTT() {
        try {
            const response = await fetch('/media/metadataEsp.vtt');
            const vttContent = await response.text();
            this.quizQuestions = this.parseVTTQuestions(vttContent);
            console.log('[QUIZ] Preguntas cargadas:', this.quizQuestions.length);
        } catch (error) {
            console.error('[QUIZ] Error cargando preguntas VTT:', error);
        }
    }

    /**
     * Parsea preguntas del archivo VTT
     */
    parseVTTQuestions(vttContent) {
        const questions = [];
        const lines = vttContent.split('\n');
        let currentTime = null;
        let currentText = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.includes('-->')) {
                const timeParts = line.split(' --> ');
                currentTime = this.timeToSeconds(timeParts[0]);
            } else if (line && currentTime !== null && !line.includes('WEBVTT')) {
                currentText += line + '\n';

                if (!lines[i + 1] || lines[i + 1].trim() === '') {
                    if (currentText.trim()) {
                        questions.push({
                            time: currentTime,
                            question: currentText.trim(),
                            answered: false
                        });
                    }
                    currentText = '';
                    currentTime = null;
                }
            }
        }

        return questions;
    }

    /**
     * Convierte timestamp VTT a segundos
     */
    timeToSeconds(timeStr) {
        const parts = timeStr.trim().split(':');
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseFloat(parts[2]) || 0;
        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * Configura listener del video para pausar en preguntas
     */
    setupVideoListener() {
        this.videoElement = document.getElementById('videoPlayer');
        if (!this.videoElement) return;

        this.videoElement.addEventListener('timeupdate', () => {
            // Solo pausar si el sistema está ACTIVO
            if (!this.isEnabled) return;

            const currentTime = this.videoElement.currentTime;
            
            const question = this.quizQuestions.find(q => 
                Math.abs(q.time - currentTime) < 0.5 && !q.answered
            );

            if (question && !this.isWaitingForAnswer) {
                this.pauseAndAskQuestion(question);
            }
        });
    }

    /**
     * Pausa el video y envía pregunta al cliente
     */
    pauseAndAskQuestion(question) {
        console.log('[QUIZ] Pausa en pregunta:', question.question);
        
        this.isWaitingForAnswer = true;
        this.currentQuestion = question;

        if (this.videoElement) {
            this.videoElement.pause();
        }

        if (this.socket) {
            this.socket.emit('send-question', {
                to: this.getRemoteUserId(),
                question: question.question,
                time: question.time
            });
        }

        this.displayQuestion(question);
    }

    /**
     * Obtiene el ID del usuario remoto en la sala
     */
    getRemoteUserId() {
        if (window.socket && window.socket.users) {
            return window.socket.users.find(u => u !== window.userId);
        }
        return null;
    }

    /**
     * Muestra la pregunta en la UI
     */
    displayQuestion(question) {
        const overlay = document.getElementById('videoOverlay');
        const quizContent = document.getElementById('quizContent');

        if (!overlay || !quizContent) return;

        quizContent.innerHTML = `
            <div class="quiz-box">
                <h3>Pregunta</h3>
                <p>${question.question}</p>
                <input type="text" id="answerInput" placeholder="Tu respuesta..." autofocus>
                <button id="submitAnswer" class="btn-quiz">Enviar Respuesta</button>
            </div>
        `;

        overlay.style.display = 'block';

        document.getElementById('submitAnswer').addEventListener('click', () => {
            this.submitAnswer(question);
        });

        document.getElementById('answerInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitAnswer(question);
            }
        });
    }

    /**
     * Envía la respuesta del cliente
     */
    submitAnswer(question) {
        const answerInput = document.getElementById('answerInput');
        const answer = answerInput ? answerInput.value : '';

        console.log('[QUIZ] Respuesta enviada:', answer);

        if (this.socket) {
            this.socket.emit('send-answer', {
                to: this.getRemoteUserId(),
                answer: answer,
                question: question.question
            });
        }

        question.answered = true;

        const overlay = document.getElementById('videoOverlay');
        const quizContent = document.getElementById('quizContent');
        if (overlay) overlay.style.display = 'none';
        if (quizContent) quizContent.innerHTML = '';

        if (this.isHost && this.videoElement) {
            setTimeout(() => {
                this.videoElement.play();
                this.isWaitingForAnswer = false;
                console.log('[QUIZ] Video reanudado');
            }, 500);
        }
    }

    /**
     * Configura visualización de preguntas en cliente
     */
    setupQuestionDisplay() {
        console.log('[QUIZ] Esperando preguntas del HOST...');
    }

    /**
     * Configura listeners de Socket.IO para preguntas
     */
    setupListeners() {
        if (!this.socket) return;

        this.socket.on('receive-question', (data) => {
            if (!this.isEnabled) return; // Ignorar si está desactivado
            
            console.log('[QUIZ] Pregunta recibida:', data.question);
            this.currentQuestion = data;
            
            if (!this.isHost) {
                this.displayQuestion(data);
            }
        });

        this.socket.on('receive-answer', (data) => {
            if (!this.isEnabled) return; // Ignorar si está desactivado
            
            console.log('[QUIZ] Respuesta recibida:', data.answer);
            
            if (this.isHost && this.videoElement && this.isWaitingForAnswer) {
                setTimeout(() => {
                    this.videoElement.play();
                    this.isWaitingForAnswer = false;
                    console.log('[QUIZ] Video reanudado tras respuesta');
                }, 500);
            }
        });
    }

    /**
     * Reinicia el sistema de preguntas
     */
    reset() {
        this.currentQuestion = null;
        this.isWaitingForAnswer = false;
        this.quizQuestions.forEach(q => q.answered = false);
        console.log('[QUIZ] Sistema reiniciado');
    }
}

// Crear instancia global
window.quizSync = new QuizSync();

// Escuchar evento de mi primer conexión desde el servidor
window.addEventListener('my-connection-count', (e) => {
    window.quizSync.myConnectionCount = e.detail.count;
    console.log(`[QUIZ] Mis conexiones: ${window.quizSync.myConnectionCount}`);
    
    // Primera conexión: siempre HOST (quien abre el QR)
    if (window.quizSync.myConnectionCount === 1) {
        window.quizSync.initAsHost();
    }
    // Segunda conexión: siempre CLIENT (quien escanea desde otro dispositivo)
    else if (window.quizSync.myConnectionCount === 2) {
        window.quizSync.initAsClient();
        // Si QR está abierto, intentar activar
        const modal = document.getElementById('qrModal');
        if (modal && modal.classList.contains('is-open')) {
            window.quizSync.enable();
        }
    }
});

// Escuchar cambios en mis conexiones
window.addEventListener('my-connection-count-changed', (e) => {
    if (e.detail.userId === window.userId) {
        window.quizSync.myConnectionCount = e.detail.count;
        console.log(`[QUIZ] Mis conexiones: ${window.quizSync.myConnectionCount}`);
        
        // Si se desconecta una de mis conexiones
        if (window.quizSync.myConnectionCount <= 1) {
            window.quizSync.disable();
            console.log('[QUIZ] Solo tengo 1 conexión → desactivar sincronización');
        }
    }
});

console.log('[QUIZ] Sistema OPCIONAL de sincronización de preguntas inicializado');
