// Conexión Socket.IO
const socket = io();

class RTCSignaling {
  constructor(userId, roomId) {
    this.userId = userId;
    this.roomId = roomId;
    this.peers = {};
    this.peerConnections = {};
    
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    // Otros usuarios en la sala
    socket.on('users-in-room', (users) => {
      console.log('Usuarios en sala:', users);
      users.forEach(userId => this.callUser(userId));
    });

    // Nuevo usuario se unió
    socket.on('user-joined', (data) => {
      console.log('Usuario se unió:', data.userId);
      this.callUser(data.userId);
    });

    // Recibir OFFER
    socket.on('receive-offer', async (data) => {
      await this.handleReceiveOffer(data.from, data.offer);
    });

    // Recibir ANSWER
    socket.on('receive-answer', async (data) => {
      await this.handleReceiveAnswer(data.from, data.answer);
    });

    // Recibir ICE Candidate
    socket.on('receive-ice-candidate', async (data) => {
      await this.handleICECandidate(data.from, data.candidate);
    });

    // Usuario se desconectó
    socket.on('user-left', (data) => {
      console.log('Usuario desconectado:', data.userId);
      this.closePeerConnection(data.userId);
    });
  }

  joinRoom() {
    socket.emit('join-room', this.roomId, this.userId);
  }

  async callUser(userId) {
    const peerConnection = this.createPeerConnection(userId);
    this.peerConnections[userId] = peerConnection;

    // Agregar stream local a la conexión
    const localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: { width: 640, height: 480 } 
    });
    
    localStream.getTracks().forEach(track => 
      peerConnection.addTrack(track, localStream)
    );

    // Crear OFFER
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('send-offer', { to: userId, offer });
    console.log('Offer enviado a:', userId);
  }

  async handleReceiveOffer(fromUserId, offer) {
    let peerConnection = this.peerConnections[fromUserId];
    if (!peerConnection) {
      peerConnection = this.createPeerConnection(fromUserId);
      this.peerConnections[fromUserId] = peerConnection;
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Agregar stream local
    const localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true, 
      video: { width: 640, height: 480 } 
    });
    
    localStream.getTracks().forEach(track => 
      peerConnection.addTrack(track, localStream)
    );

    // Crear ANSWER
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('send-answer', { to: fromUserId, answer });
    console.log('Answer enviado a:', fromUserId);
  }

  async handleReceiveAnswer(fromUserId, answer) {
    const peerConnection = this.peerConnections[fromUserId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Answer recibido de:', fromUserId);
    }
  }

  async handleICECandidate(fromUserId, candidate) {
    const peerConnection = this.peerConnections[fromUserId];
    if (peerConnection && candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error agregando ICE candidate:', e);
      }
    }
  }

  createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });

    // ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('send-ice-candidate', { 
          to: userId, 
          candidate: event.candidate 
        });
      }
    };

    // Recibir stream remoto
    peerConnection.ontrack = (event) => {
      console.log('Stream remoto recibido:', userId);
      document.getElementById(`remote-${userId}`)?.srcObject = event.streams[0];
    };

    return peerConnection;
  }

  closePeerConnection(userId) {
    const pc = this.peerConnections[userId];
    if (pc) {
      pc.close();
      delete this.peerConnections[userId];
    }
  }
}

// Uso
const signaling = new RTCSignaling('user1', 'room1');
signaling.joinRoom();