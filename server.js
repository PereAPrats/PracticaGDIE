const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});
const PORT = 3000;

app.use(express.json({ limit: '256kb' }));

// Middleware para configurar MIME types correctamente
app.use((req, res, next) => {
  if (req.url.endsWith('.js')) {
    res.type('application/javascript');
  } else if (req.url.endsWith('.css')) {
    res.type('text/css');
  } else if (req.url.endsWith('.json')) {
    res.type('application/json');
  } else if (req.url.endsWith('.vtt')) {
    res.type('text/vtt');
  } else if (req.url.endsWith('.svg')) {
    res.type('image/svg+xml');
  } else if (req.url.endsWith('.png')) {
    res.type('image/png');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== SIGNALING ==========
const rooms = {}; // { roomId: { users: {userId: socket}, offers: {} } }

io.on('connection', (socket) => {
  console.log(`[SIGNALING] Usuario conectado: ${socket.id}`);

  // Unirse a una sala
  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    socket.userId = userId;
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { users: {}, offers: {} };
    }
    rooms[roomId].users[userId] = socket.id;

    console.log(`[SIGNALING] ${userId} se unió a sala ${roomId}`);
    
    // Notificar a otros usuarios en la sala
    socket.to(roomId).emit('user-joined', { userId, socketId: socket.id });
    
    // Enviar lista de usuarios existentes al nuevo usuario
    socket.emit('users-in-room', Object.keys(rooms[roomId].users).filter(u => u !== userId));
  });

  // Recibir y reenviar OFFER
  socket.on('send-offer', (data) => {
    const { to, offer } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] Offer de ${socket.userId} a ${to}`);
    io.to(rooms[roomId].users[to]).emit('receive-offer', { from: socket.userId, offer });
  });

  // Recibir y reenviar ANSWER
  socket.on('send-answer', (data) => {
    const { to, answer } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] Answer de ${socket.userId} a ${to}`);
    io.to(rooms[roomId].users[to]).emit('receive-answer', { from: socket.userId, answer });
  });

  // Recibir y reenviar ICE CANDIDATES
  socket.on('send-ice-candidate', (data) => {
    const { to, candidate } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] ICE candidate de ${socket.userId} a ${to}`);
    io.to(rooms[roomId].users[to]).emit('receive-ice-candidate', { from: socket.userId, candidate });
  });

  // Desconexión
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const userId = socket.userId;
    
    if (rooms[roomId]) {
      delete rooms[roomId].users[userId];
      io.to(roomId).emit('user-left', { userId });
      
      if (Object.keys(rooms[roomId].users).length === 0) {
        delete rooms[roomId];
      }
    }
    
    console.log(`[SIGNALING] ${userId} desconectado`);
  });
});

// ========== API REST ENDPOINTS ==========

// Endpoint para telemetría
app.post('/api/telemetry', (req, res) => {
  const body = req.body || {};
  const { event, data, sessionId } = body;
  console.log(`[TELEMETRY] Event: ${event || 'unknown'} | Session: ${sessionId || 'unknown'}`, data || {});
  res.status(204).end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`--- SERVIDOR SIGNALING DESPLEGADO ---`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Signaling: ws://localhost:${PORT}`);
});