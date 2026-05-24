/**
 * signaling-init.js - Inicializacion de Socket.IO y WebRTC
 * Unifica la conexion de signaling, salas, offer/answer/ICE y chat.
 */

(function () {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user') || 'user_' + Math.random().toString(36).substr(2, 9);
    const roomId = params.get('room') || 'room1';

    window.userId = userId;
    window.roomId = roomId;

    const userDisplay = document.getElementById('userIdDisplay');
    if (userDisplay) {
        userDisplay.textContent = userId;
    }

    class WebRTCManager {
        constructor(socket, userIdValue, roomIdValue) {
            this.socket = socket;
            this.userId = userIdValue;
            this.roomId = roomIdValue;
            this.localStream = null;
            this.localStreamPromise = null;
            this.peerConnections = new Map();
            this.dataChannels = new Map();
            this.remoteUserIds = new Set();
            this.statusElement = document.getElementById('videoStatus');
            this.activeQuestionSession = null;
            this.questionSequence = 0;

            this.bindSocketEvents();
            this.setupBeforeUnload();
        }

        setupBeforeUnload() {
            window.addEventListener('beforeunload', () => {
                this.closeAllPeerConnections();
                if (this.localStream) {
                    // Apaga camara y microfono al cerrar la pagina para liberar el dispositivo.
                    this.localStream.getTracks().forEach(track => track.stop());
                }
            });
        }

        bindSocketEvents() {
            this.socket.on('connect', async () => {
                console.log('[SIGNALING] Conectado a servidor. Socket ID:', this.socket.id);
                this.updateStatus('Conectado al servidor de signaling.');
                this.socket.emit('join-room', this.roomId, this.userId);

                try {
                    // Captura de camara/microfono desactivada por peticion del usuario.
                    // await this.ensureLocalStream();
                    this.updateStatus('Camara y microfono desactivados en esta version.');
                } catch (error) {
                    // Si el usuario bloquea permisos, la negociacion WebRTC no podra enviar medios.
                    this.updateStatus('No se pudo acceder a camara o microfono.');
                }
            });

            this.socket.on('users-in-room', async (users) => {
                const otherUsers = Array.isArray(users) ? users.filter(user => user !== this.userId) : [];
                console.log('[SIGNALING] Usuarios en sala:', otherUsers);

                for (const remoteUserId of otherUsers) {
                    this.remoteUserIds.add(remoteUserId);
                    if (this.shouldInitiate(remoteUserId)) {
                        await this.createOffer(remoteUserId);
                    }
                }

                window.dispatchEvent(new CustomEvent('usersInRoom', { detail: { users: otherUsers } }));
            });

            this.socket.on('user-joined', async (data) => {
                const remoteUserId = data && data.userId;
                if (!remoteUserId || remoteUserId === this.userId) {
                    return;
                }

                console.log('[SIGNALING] Usuario se unio:', remoteUserId);
                this.remoteUserIds.add(remoteUserId);

                if (this.shouldInitiate(remoteUserId)) {
                    await this.createOffer(remoteUserId);
                }

                window.dispatchEvent(new CustomEvent('userJoined', { detail: data }));
            });

            this.socket.on('receive-offer', async (data) => {
                console.log('[SIGNALING] Oferta recibida de:', data.from);
                await this.handleOffer(data.from, data.offer);
                window.dispatchEvent(new CustomEvent('receiveOffer', { detail: data }));
            });

            this.socket.on('receive-answer', async (data) => {
                console.log('[SIGNALING] Respuesta recibida de:', data.from);
                await this.handleAnswer(data.from, data.answer);
                window.dispatchEvent(new CustomEvent('receiveAnswer', { detail: data }));
            });

            this.socket.on('receive-ice-candidate', async (data) => {
                console.log('[SIGNALING] ICE candidate recibido de:', data.from);
                await this.handleIceCandidate(data.from, data.candidate);
                window.dispatchEvent(new CustomEvent('receiveIceCandidate', { detail: data }));
            });

            this.socket.on('question-start', (data) => {
                this.routeQuizMessage({ ...data, type: 'question-start' }, 'socket');
            });

            this.socket.on('question-start-ack', (data) => {
                this.routeQuizMessage({ ...data, type: 'question-start-ack' }, 'socket');
            });

            this.socket.on('question-answer', (data) => {
                this.routeQuizMessage({ ...data, type: 'question-answer' }, 'socket');
            });

            this.socket.on('question-result', (data) => {
                this.routeQuizMessage({ ...data, type: 'question-result' }, 'socket');
            });

            this.socket.on('user-left', (data) => {
                const remoteUserId = data && data.userId;
                console.log('[SIGNALING] Usuario desconectado:', remoteUserId);
                if (remoteUserId) {
                    this.remoteUserIds.delete(remoteUserId);
                    this.closePeerConnection(remoteUserId);
                }
                window.dispatchEvent(new CustomEvent('userLeft', { detail: data }));
            });

            this.socket.on('my-connection-count', (data) => {
                window.dispatchEvent(new CustomEvent('my-connection-count', { detail: data }));
            });

            this.socket.on('my-connection-count-changed', (data) => {
                window.dispatchEvent(new CustomEvent('my-connection-count-changed', { detail: data }));
            });

            this.socket.on('disconnect', () => {
                console.log('[SIGNALING] Desconectado del servidor');
                this.updateStatus('Desconectado del servidor de signaling.');
                window.dispatchEvent(new CustomEvent('signalingDisconnect'));
            });
        }

        shouldInitiate(remoteUserId) {
            if (!remoteUserId || remoteUserId === this.userId) {
                return false;
            }

            return this.userId.localeCompare(remoteUserId) < 0;
        }

        updateStatus(message) {
            if (this.statusElement) {
                this.statusElement.textContent = message;
            }
        }

        routeQuizMessage(payload, transport) {
            if (!payload || typeof payload !== 'object') {
                return;
            }

            if (payload.type === 'question-start') {
                window.dispatchEvent(new CustomEvent('question-start', { detail: { ...payload, transport } }));
                return;
            }

            if (payload.type === 'question-start-ack') {
                window.dispatchEvent(new CustomEvent('question-start-ack', { detail: { ...payload, transport } }));
                // Si hay una sesión activa, registrar al usuario en expectedUsers
                try {
                    const session = this.activeQuestionSession;
                    const userId = payload.fromUserId || payload.userId || payload.from || null;
                    if (session && userId) {
                        session.expectedUsers.add(userId);
                        // Si la respuesta ya había llegado antes del ACK, reintentar la
                        // resolución inmediatamente para no esperar al timeout.
                        this.tryResolveQuestionSession(session);
                        if (session.expectedUsers.size > 0 && session.votesByUser.size >= session.expectedUsers.size) {
                            this.finalizeQuestionSession('complete');
                        }
                    }
                } catch (e) { /* ignore */ }
                return;
            }

            if (payload.type === 'question-result') {
                window.dispatchEvent(new CustomEvent('question-result', { detail: { ...payload, transport } }));
                return;
            }

            if (payload.type === 'question-answer') {
                window.dispatchEvent(new CustomEvent('question-answer', { detail: { ...payload, transport } }));
                this.handleQuestionAnswer(payload);
            }
        }

        getOpenDataChannels() {
            const channels = [];

            for (const [remoteUserId, channel] of this.dataChannels.entries()) {
                if (channel && channel.readyState === 'open') {
                    channels.push({ remoteUserId, channel });
                }
            }

            return channels;
        }

        hasRemotePeers() {
            return this.getOpenDataChannels().length > 0 || this.remoteUserIds.size > 0;
        }

        sendQuizPayloadToPeers(payload) {
            const channels = this.getOpenDataChannels();

            channels.forEach(({ channel }) => {
                try {
                    channel.send(JSON.stringify(payload));
                } catch (error) {
                    console.warn('[WEBRTC] No se pudo enviar por DataChannel:', error);
                }
            });

            if (this.socket && this.socket.connected) {
                this.socket.emit(payload.type, payload);
            }
        }

        sendQuizAnswer(payload) {
            const message = {
                ...payload,
                type: 'question-answer',
                fromUserId: this.userId,
                roomId: this.roomId
            };

            const channels = this.getOpenDataChannels();

            if (channels.length > 0) {
                try {
                    channels[0].channel.send(JSON.stringify(message));
                    return true;
                } catch (error) {
                    console.warn('[WEBRTC] No se pudo enviar la respuesta por DataChannel:', error);
                }
            }

            if (this.socket && this.socket.connected) {
                this.socket.emit('question-answer', message);
                return true;
            }

            return false;
        }

        askQuestion(questionPayload) {
            if (!questionPayload || !questionPayload.quiz) {
                return Promise.resolve(null);
            }

            // La lista de participantes esperados se construye con los ACKs reales de esta
            // pregunta. Así evitamos arrastrar usuarios antiguos de la sala y bloquear la
            // resolución hasta el timeout.
            const expectedUsers = new Set();

            if (this.activeQuestionSession) {
                return this.activeQuestionSession.promise;
            }

            const questionId = questionPayload.questionId || `question_${Date.now()}_${++this.questionSequence}`;
            const timeoutMs = Number.isFinite(questionPayload.timeoutMs) ? questionPayload.timeoutMs : 15000;
            let resolveSession;
            let rejectSession;

            const session = {
                questionId,
                quiz: questionPayload.quiz,
                restartTime: questionPayload.restartTime,
                expectedUsers,
                votesByUser: new Map(),
                voteOrder: [],
                timeoutMs,
                timerId: null,
                promise: null,
                resolve: null,
                reject: null
            };

            session.promise = new Promise((resolve, reject) => {
                resolveSession = resolve;
                rejectSession = reject;
            });

            session.resolve = resolveSession;
            session.reject = rejectSession;
            this.activeQuestionSession = session;
            this.updateStatus('Pregunta enviada al móvil. Esperando respuesta...');

            const payload = {
                type: 'question-start',
                questionId,
                quiz: questionPayload.quiz,
                restartTime: questionPayload.restartTime,
                roomId: this.roomId,
                fromUserId: this.userId,
                timeoutMs
            };

            this.sendQuizPayloadToPeers(payload);

            session.timerId = setTimeout(() => {
                this.finalizeQuestionSession('timeout');
            }, timeoutMs);

            return session.promise;
        }

        handleQuestionAnswer(payload) {
            const session = this.activeQuestionSession;
            if (!session || !payload || payload.questionId !== session.questionId) {
                return;
            }

            const userId = payload.fromUserId || payload.userId || payload.from || 'unknown';
            if (!userId) {
                return;
            }

            const selectedIndex = Number.isInteger(payload.selectedIndex)
                ? payload.selectedIndex
                : Number(payload.selectedIndex);

            if (!Number.isInteger(selectedIndex)) {
                return;
            }

            session.votesByUser.set(userId, selectedIndex);
            if (!session.voteOrder.includes(userId)) {
                session.voteOrder.push(userId);
            }

            this.updateStatus(`Respuesta recibida de ${userId}. Validando mayoría...`);

            if (this.tryResolveQuestionSession(session)) {
                return;
            }

            if (session.expectedUsers.size > 0 && session.votesByUser.size >= session.expectedUsers.size) {
                this.finalizeQuestionSession('complete');
            }
        }

        tryResolveQuestionSession(session) {
            if (!session || session.votesByUser.size === 0 || session.expectedUsers.size === 0) {
                return false;
            }

            const counts = new Map();
            for (const selectedIndex of session.votesByUser.values()) {
                counts.set(selectedIndex, (counts.get(selectedIndex) || 0) + 1);
            }

            const totalExpected = Math.max(session.expectedUsers.size, session.votesByUser.size);
            const majorityThreshold = Math.floor(totalExpected / 2) + 1;

            for (const [selectedIndex, count] of counts.entries()) {
                if (count >= majorityThreshold) {
                    this.finalizeQuestionSession('majority', selectedIndex);
                    return true;
                }
            }

            return false;
        }

        finalizeQuestionSession(reason, forcedSelectedIndex = null) {
            const session = this.activeQuestionSession;
            if (!session) {
                return;
            }

            if (session.timerId) {
                clearTimeout(session.timerId);
            }

            const counts = new Map();
            for (const selectedIndex of session.votesByUser.values()) {
                counts.set(selectedIndex, (counts.get(selectedIndex) || 0) + 1);
            }

            let selectedIndex = forcedSelectedIndex;
            let isTie = false;
            if (!Number.isInteger(selectedIndex)) {
                let bestCount = -1;
                const topCandidates = [];

                for (const [candidateIndex, count] of counts.entries()) {
                    if (count > bestCount) {
                        bestCount = count;
                        topCandidates.length = 0;
                        topCandidates.push(candidateIndex);
                    } else if (count === bestCount) {
                        topCandidates.push(candidateIndex);
                    }
                }

                if (topCandidates.length === 1) {
                    selectedIndex = topCandidates[0];
                } else if (topCandidates.length > 1) {
                    isTie = true;
                }
            }

            this.activeQuestionSession = null;

            if (isTie) {
                const tiePayload = {
                    type: 'question-result',
                    questionId: session.questionId,
                    selectedIndex: null,
                    votes: Object.fromEntries(counts.entries()),
                    reason: 'tie',
                    roomId: this.roomId,
                    fromUserId: this.userId
                };

                this.sendQuizPayloadToPeers(tiePayload);
                this.updateStatus('Empate detectado. Repitiendo capitulo.');

                if (typeof session.resolve === 'function') {
                    session.resolve(null);
                }
                return;
            }

            if (!Number.isInteger(selectedIndex)) {
                this.updateStatus('No se obtuvo una respuesta valida del movil.');
                if (typeof session.resolve === 'function') {
                    session.resolve(null);
                }
                return;
            }

            const resultPayload = {
                type: 'question-result',
                questionId: session.questionId,
                selectedIndex,
                votes: Object.fromEntries(counts.entries()),
                reason,
                roomId: this.roomId,
                fromUserId: this.userId
            };

            this.sendQuizPayloadToPeers(resultPayload);
            this.updateStatus(`Respuesta mayoritaria recibida (${selectedIndex}).`);

            if (typeof session.resolve === 'function') {
                session.resolve(selectedIndex);
            }
        }

        async ensureLocalStream() {
            // Captura de medios desactivada: no se solicita getUserMedia.
            return null;

            /*
            if (this.localStream) {
                return this.localStream;
            }

            if (this.localStreamPromise) {
                return this.localStreamPromise;
            }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia no disponible');
            }

            // Captura los medios locales del dispositivo (camara + microfono).
            // Este stream se reutiliza en toda la sesion para no pedir permisos varias veces.
            this.localStreamPromise = navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            }).then((stream) => {
                this.localStream = stream;

                return stream;
            }).catch((error) => {
                this.localStreamPromise = null;
                throw error;
            });

            return this.localStreamPromise;
            */
        }

        async createOffer(remoteUserId) {
            if (this.peerConnections.has(remoteUserId)) {
                return;
            }

            const peerConnection = await this.getOrCreatePeerConnection(remoteUserId);

            try {
                const dataChannel = peerConnection.createDataChannel('quiz-control');
                this.setupDataChannel(remoteUserId, dataChannel);
            } catch (error) {
                console.warn('[WEBRTC] No se pudo crear DataChannel:', error);
            }

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.socket.emit('send-offer', { to: remoteUserId, offer });
            this.updateStatus(`Enviando offer a ${remoteUserId}...`);
        }

        async handleOffer(remoteUserId, offer) {
            const peerConnection = await this.getOrCreatePeerConnection(remoteUserId);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.socket.emit('send-answer', { to: remoteUserId, answer });
            this.updateStatus(`Respuesta enviada a ${remoteUserId}.`);
        }

        async handleAnswer(remoteUserId, answer) {
            const peerConnection = this.peerConnections.get(remoteUserId);
            if (!peerConnection) {
                return;
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            this.updateStatus(`Conexion WebRTC establecida con ${remoteUserId}.`);
        }

        async handleIceCandidate(remoteUserId, candidate) {
            const peerConnection = this.peerConnections.get(remoteUserId);
            if (!peerConnection || !candidate) {
                return;
            }

            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('[WEBRTC] Error agregando ICE candidate:', error);
            }
        }

        async getOrCreatePeerConnection(remoteUserId) {
            let peerConnection = this.peerConnections.get(remoteUserId);
            if (peerConnection) {
                return peerConnection;
            }

            // Captura local desactivada (sin camara/microfono).
            // await this.ensureLocalStream();

            peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });

            // Envio de pistas locales desactivado por peticion (microfono/camara ocultos).
            // this.localStream.getTracks().forEach(track => {
            //     peerConnection.addTrack(track, this.localStream);
            // });

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('send-ice-candidate', {
                        to: remoteUserId,
                        candidate: event.candidate
                    });
                }
            };

            peerConnection.ondatachannel = (event) => {
                this.setupDataChannel(remoteUserId, event.channel);
            };

            peerConnection.ontrack = (event) => {
                const stream = event.streams && event.streams[0];
                if (stream) {
                    console.log('[WEBRTC] Stream remoto recibido de', remoteUserId);
                }
            };

            peerConnection.onconnectionstatechange = () => {
                this.updateStatus(`Estado WebRTC: ${peerConnection.connectionState}`);
            };

            this.peerConnections.set(remoteUserId, peerConnection);
            return peerConnection;
        }

        setupDataChannel(remoteUserId, dataChannel) {
            if (!dataChannel) {
                return;
            }

            this.dataChannels.set(remoteUserId, dataChannel);

            dataChannel.onopen = () => {
                console.log('[WEBRTC] DataChannel abierto con', remoteUserId);
            };

            dataChannel.onmessage = (event) => {
                try {
                    const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                    if (!payload || typeof payload !== 'object') {
                        return;
                    }

                    if (payload.type === 'question-start' || payload.type === 'question-result' || payload.type === 'question-start-ack') {
                        this.routeQuizMessage(payload, 'datachannel');
                        return;
                    }

                    if (payload.type === 'question-answer') {
                        this.routeQuizMessage({ ...payload, fromUserId: payload.fromUserId || remoteUserId }, 'datachannel');
                    }
                } catch (error) {
                    console.warn('[WEBRTC] Mensaje DataChannel no JSON:', error);
                }
            };

            dataChannel.onclose = () => {
                console.log('[WEBRTC] DataChannel cerrado con', remoteUserId);
                this.dataChannels.delete(remoteUserId);
            };
        }

        closePeerConnection(remoteUserId) {
            const peerConnection = this.peerConnections.get(remoteUserId);
            if (!peerConnection) {
                return;
            }

            peerConnection.close();
            this.peerConnections.delete(remoteUserId);
        }

        closeAllPeerConnections() {
            for (const remoteUserId of this.peerConnections.keys()) {
                this.closePeerConnection(remoteUserId);
            }
        }
    }

    if (typeof io === 'undefined') {
        console.warn('[SIGNALING] Socket.IO no cargado');
        return;
    }

    const socket = io();
    window.socket = socket;
    window.webrtcManager = new WebRTCManager(socket, userId, roomId);
    window.quizBridge = {
        askQuestion: (payload) => window.webrtcManager.askQuestion(payload),
        hasPeers: () => window.webrtcManager.hasRemotePeers(),
        sendAnswer: (payload) => window.webrtcManager.sendQuizAnswer(payload),
        sendQuestionStart: (payload) => window.webrtcManager.sendQuizPayloadToPeers({ ...payload, type: 'question-start' }),
        sendQuestionResult: (payload) => window.webrtcManager.sendQuizPayloadToPeers({ ...payload, type: 'question-result' }),
        sendQuestionStartAck: (payload) => window.webrtcManager.sendQuizPayloadToPeers({ ...payload, type: 'question-start-ack' })
    };

    console.log(`[SIGNALING] Inicializando con userId=${userId}, roomId=${roomId}`);
})();
