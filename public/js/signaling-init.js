/**
 * signaling-init.js - Inicializacion de Socket.IO y WebRTC
 * Unifica la conexion de signaling, salas, offer/answer/ICE y video local/remoto.
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
            this.remoteUserIds = new Set();
            this.localVideo = null;
            this.remoteVideo = null;
            this.statusElement = document.getElementById('videoStatus');

            this.ensureVideoElements();
            this.bindSocketEvents();
            this.setupBeforeUnload();
        }

        /*ensureVideoElements() {
            this.localVideo = document.getElementById('localVideo');
            this.remoteVideo = document.getElementById('remoteVideo');

            if (this.localVideo && this.remoteVideo) {
                return;
            }
            const placeholder = document.getElementById('webrtcPanelPlaceholder');

            if (placeholder) {
                // Load partial asynchronously; non-blocking fallback to dynamic creation
                fetch('/html/partials/webrtc-panel.html').then(resp => {
                    if (!resp.ok) throw new Error('No se pudo cargar partial');
                    return resp.text();
                }).then(html => {
                    placeholder.innerHTML = html;
                    this.localVideo = document.getElementById('localVideo');
                    this.remoteVideo = document.getElementById('remoteVideo');
                }).catch(err => {
                    console.warn('[SIGNALING] No se pudo cargar partial webrtc-panel, usando fallback dinámico', err);
                    this._createDynamicPanel();
                });
            } else {
                this._createDynamicPanel();
            }
        }

        _createDynamicPanel() {
            const container = document.querySelector('.container-custom-p3') || document.body;
            const sidebar = document.querySelector('.sidebar-p3-chat');
            const panel = document.createElement('section');
            panel.id = 'webrtcPanel';
            panel.style.display = 'grid';
            panel.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
            panel.style.gap = '12px';
            panel.style.margin = '16px 0';

                        panel.innerHTML = `
                                <article style="background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:12px;">
                                    <h3 style="margin:0 0 8px;">Video local</h3>
                                    <video id="localVideo" autoplay muted playsinline style="width:100%;background:#111;border-radius:8px;display:block;"></video>
                                </article>
                                <article style="background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:12px;">
                                    <h3 style="margin:0 0 8px;">Video remoto</h3>
                                    <video id="remoteVideo" autoplay playsinline style="width:100%;background:#111;border-radius:8px;display:block;"></video>
                                </article>
                        `;

            if (sidebar && sidebar.parentNode === container) {
                container.insertBefore(panel, sidebar);
            } else {
                container.appendChild(panel);
            }

            this.localVideo = document.getElementById('localVideo');
            this.remoteVideo = document.getElementById('remoteVideo');
        }*/

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

                // Muestra la previsualizacion local (lo que capta tu propia camara/mic).
                if (this.localVideo) {
                    this.localVideo.srcObject = stream;
                    this.localVideo.play().catch(() => {});
                }

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

            peerConnection.ontrack = (event) => {
                const stream = event.streams && event.streams[0];
                // Aqui llega el stream remoto (camara/microfono del otro usuario).
                if (stream && this.remoteVideo) {
                    this.remoteVideo.srcObject = stream;
                    this.remoteVideo.play().catch(() => {});
                }
            };

            peerConnection.onconnectionstatechange = () => {
                this.updateStatus(`Estado WebRTC: ${peerConnection.connectionState}`);
            };

            this.peerConnections.set(remoteUserId, peerConnection);
            return peerConnection;
        }

        closePeerConnection(remoteUserId) {
            const peerConnection = this.peerConnections.get(remoteUserId);
            if (!peerConnection) {
                return;
            }

            peerConnection.close();
            this.peerConnections.delete(remoteUserId);

            if (this.remoteVideo) {
                this.remoteVideo.srcObject = null;
            }
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

    // Oculta los elementos de video local/remoto si existen en el DOM.
    const localVideoEl = document.getElementById('localVideo');
    const remoteVideoEl = document.getElementById('remoteVideo');
    if (localVideoEl) localVideoEl.style.display = 'none';
    if (remoteVideoEl) remoteVideoEl.style.display = 'none';

    console.log(`[SIGNALING] Inicializando con userId=${userId}, roomId=${roomId}`);
})();
