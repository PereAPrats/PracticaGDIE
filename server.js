require('dotenv').config();

const axios = require('axios');
const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs/promises');
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
const MAX_CHAT_HISTORY = 100;
const rooms = {}; // { roomId: { users: {userId: socket[]}, offers: {}, messages: [] } }
const CHAT_HISTORY_FILE = path.join(__dirname, 'data', 'chat-history.json');

async function loadChatHistory() {
  try {
    const raw = await fs.readFile(CHAT_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    for (const [roomId, messages] of Object.entries(parsed)) {
      if (Array.isArray(messages)) {
        rooms[roomId] = rooms[roomId] || { users: {}, offers: {}, messages: [] };
        rooms[roomId].messages = messages.slice(-MAX_CHAT_HISTORY);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[CHAT] No se pudo cargar el historial de chat:', error.message);
    }
  }
}

async function saveChatHistory() {
  try {
    const payload = {};

    for (const [roomId, room] of Object.entries(rooms)) {
      if (Array.isArray(room.messages) && room.messages.length > 0) {
        payload[roomId] = room.messages.slice(-MAX_CHAT_HISTORY);
      }
    }

    await fs.mkdir(path.dirname(CHAT_HISTORY_FILE), { recursive: true });
    await fs.writeFile(CHAT_HISTORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[CHAT] No se pudo guardar el historial de chat:', error.message);
  }
}

// Moderation helpers
const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_API_TOKEN || null;
// Modelo multilingüe de toxicidad soportado por HF Inference API
const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_MODEL || 'unitary/multilingual-toxic-xlm-roberta';
const HUGGINGFACE_API_BASE = process.env.HUGGINGFACE_API_BASE || 'https://router.huggingface.co/hf-inference/models';
const TOXIC_LABELS = new Set(['toxic', 'toxicity', 'insult', 'threat', 'hate speech', 'harassment', 'profanity', 'abuse', 'offensive', 'off', 'offensive_language', 'abusive']);
let warnedMissingHfToken = false;
const LOCAL_MODERATION_PATTERNS = [
  /\bidiota\b/i,
  /\best[úu]pido\b/i,
  /\best[úu]pida\b/i,
  /\bimb[eé]cil\b/i,
  /\bgilipollas\b/i,
  /\bpayaso\b/i,
  /\bsubnormal\b/i,
  /\bmierda\b/i,
  /\bputa\b/i,
  /\bhijo\s*de\s*puta\b/i
];

function extractHFClassification(payload) {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractHFClassification(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof payload === 'object') {
    if (typeof payload.label === 'string' && payload.score !== undefined) {
      return {
        label: String(payload.label || '').toLowerCase().trim(),
        score: Number(payload.score || 0)
      };
    }

    if (Array.isArray(payload.labels) && Array.isArray(payload.scores)) {
      return {
        label: String(payload.labels[0] || '').toLowerCase().trim(),
        score: Number(payload.scores[0] || 0)
      };
    }

    if (typeof payload.prediction === 'string' && payload.probability !== undefined) {
      return {
        label: String(payload.prediction || '').toLowerCase().trim(),
        score: Number(payload.probability || 0)
      };
    }
  }

  return null;
}

async function moderateWithHuggingFace(text) {
  if (!HUGGINGFACE_API_TOKEN) throw new Error('no-token');
  try {
    const resp = await axios.post(
      `${HUGGINGFACE_API_BASE}/${HUGGINGFACE_MODEL}`,
      {
        inputs: text,
        options: {
          wait_for_model: true
        }
      },
      { headers: { Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}` }, timeout: 6000 }
    );

    const data = resp.data;
    const classification = extractHFClassification(data);

    if (classification) {
      const { label, score } = classification;
      const isToxicLabel = label === 'toxic' || label.includes('toxic') || [...TOXIC_LABELS].some((token) => label.includes(token));

      console.log(`[MOD][HF] label=${label} score=${score.toFixed(3)} text=${String(text).slice(0, 80)}`);

      if (label === 'not_toxic' || label === 'neutral') {
        return { flagged: false, reason: `hf:${label}`, score };
      }

      if (isToxicLabel && score >= 0.55) {
        return { flagged: true, reason: `hf:${label}`, score };
      }

      return { flagged: false, reason: `hf:${label}`, score };
    }

    console.warn('[MOD][HF] Unexpected response shape:', JSON.stringify(data).slice(0, 240));
    return { flagged: false, reason: 'hf-unparsed' };
  } catch (err) {
    // propagate special error for missing token
    if (err.message && err.message.includes('401')) throw new Error('hf-auth');
    if (err.response && err.response.status) {
      console.warn('[MOD][HF] HTTP error:', err.response.status, err.response.data || '');
    }
    // timeout or other
    throw err;
  }
}

async function moderateMessage(text) {
  if (HUGGINGFACE_API_TOKEN) {
    try {
      return await moderateWithHuggingFace(text);
    } catch (err) {
      console.warn('[MOD] HuggingFace moderation failed, allowing message:', err.message || err);
      return { flagged: false, reason: 'hf-error' };
    }
  }
  if (!warnedMissingHfToken) {
    console.warn('[MOD] No Hugging Face token configured; using local moderation fallback');
    warnedMissingHfToken = true;
  }

  const normalizedText = String(text || '').toLowerCase();
  const matchedPattern = LOCAL_MODERATION_PATTERNS.find((pattern) => pattern.test(normalizedText));

  if (matchedPattern) {
    return { flagged: true, reason: 'local-rule', score: 1 };
  }

  return { flagged: false, reason: 'local-rule', score: 0 };
}

const chatHistoryReady = loadChatHistory();

function emitToUser(roomId, userId, eventName, payload) {
  const room = rooms[roomId];
  const socketIds = room && room.users ? room.users[userId] : null;

  if (!Array.isArray(socketIds) || socketIds.length === 0) {
    console.warn(`[SIGNALING] Usuario destino no encontrado: ${userId} en sala ${roomId}`);
    return;
  }

  io.to(socketIds).emit(eventName, payload);
}

io.on('connection', (socket) => {
  // No loguear aquí, solo cuando el usuario se une a una sala con su userId

  // Unirse a una sala
  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    socket.userId = userId;
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { users: {}, offers: {}, messages: [] };
    }

    // Almacenar MÚLTIPLES sockets por usuario (un user puede tener 2+ dispositivos)
    if (!rooms[roomId].users[userId]) {
      rooms[roomId].users[userId] = [];
    }
    rooms[roomId].users[userId].push(socket.id);

    const userConnectionCount = rooms[roomId].users[userId].length;
    console.log(`[SIGNALING] ${userId} se unió a sala ${roomId} (conexión ${userConnectionCount})`);
    
    // Emitir a ESTE cliente cuántas conexiones propias tiene ahora
    socket.emit('my-connection-count', { count: userConnectionCount });
    
    // Notificar a otros usuarios en la sala
    socket.to(roomId).emit('user-joined', { userId, socketId: socket.id });
    
    // Enviar lista de usuarios existentes al nuevo usuario
    socket.emit('users-in-room', Object.keys(rooms[roomId].users).filter(u => u !== userId));

    // Enviar historial de chat al nuevo usuario para que vea los mensajes previos
    socket.emit('chat-history', rooms[roomId].messages);
  });

  // Recibir y reenviar OFFER
  socket.on('send-offer', (data) => {
    const { to, offer } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] Offer de ${socket.userId} a ${to}`);
    emitToUser(roomId, to, 'receive-offer', { from: socket.userId, offer });
  });

  // Recibir y reenviar ANSWER
  socket.on('send-answer', (data) => {
    const { to, answer } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] Answer de ${socket.userId} a ${to}`);
    emitToUser(roomId, to, 'receive-answer', { from: socket.userId, answer });
  });

  // Recibir y reenviar ICE CANDIDATES
  socket.on('send-ice-candidate', (data) => {
    const { to, candidate } = data;
    const roomId = socket.roomId;
    console.log(`[SIGNALING] ICE candidate de ${socket.userId} a ${to}`);
    emitToUser(roomId, to, 'receive-ice-candidate', { from: socket.userId, candidate });
  });

  // Reenvio de preguntas y respuestas del quiz cuando no hay DataChannel disponible
  socket.on('question-start', (data) => {
    const roomId = socket.roomId;
    console.log(`[QUIZ] Pregunta enviada por ${socket.userId} en sala ${roomId}`);
    socket.to(roomId).emit('question-start', {
      ...data,
      roomId,
      fromUserId: socket.userId
    });
  });

  socket.on('question-answer', (data) => {
    const roomId = socket.roomId;
    console.log(`[QUIZ] Respuesta de ${socket.userId} en sala ${roomId}`);
    socket.to(roomId).emit('question-answer', {
      ...data,
      roomId,
      fromUserId: socket.userId
    });
  });

  socket.on('question-result', (data) => {
    const roomId = socket.roomId;
    console.log(`[QUIZ] Resultado de ${socket.userId} en sala ${roomId}`);
    socket.to(roomId).emit('question-result', {
      ...data,
      roomId,
      fromUserId: socket.userId
    });
  });

  // Recibir y reenviar MENSAJES DE CHAT
  socket.on('send-chat-message', (data) => {
    const roomId = socket.roomId;
    const userId = socket.userId;
    (async () => {
      console.log(`[CHAT] Mensaje de ${userId}: ${String(data.message).substring(0, 50)}...`);
      let text = data.message || '';

      // Moderación (IA o regex)
      try {
        const mod = await moderateMessage(text);
        if (mod && mod.flagged) {
          console.log(`[MOD] Mensaje bloqueado por moderación en sala ${roomId} (reason=${mod.reason})`);
          // Notificar al emisor
          socket.emit('moderation-blocked', { reason: mod.reason });
          // Replace text with placeholder
          text = '[Mensaje ocultado por moderación]';
        }
      } catch (err) {
        console.warn('[MOD] Error en moderación:', err.message || err);
      }

      const chatMessage = {
        userId: userId,
        message: text,
        timestamp: data.timestamp,
        moderated: text === '[Mensaje ocultado por moderación]'
      };

      if (rooms[roomId]) {
        rooms[roomId].messages.push(chatMessage);
        if (rooms[roomId].messages.length > MAX_CHAT_HISTORY) {
          rooms[roomId].messages = rooms[roomId].messages.slice(-MAX_CHAT_HISTORY);
        }
        saveChatHistory();
      }

      // Enviar a todos en la sala (incluyendo al remitente)
      io.to(roomId).emit('receive-chat-message', chatMessage);
    })();
  });

  // Desconexión
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const userId = socket.userId;
    
    if (rooms[roomId] && rooms[roomId].users[userId]) {
      // Remover SOLO este socket específico del usuario
      const socketIndex = rooms[roomId].users[userId].indexOf(socket.id);
      if (socketIndex > -1) {
        rooms[roomId].users[userId].splice(socketIndex, 1);
      }
      
      const remainingConnections = rooms[roomId].users[userId].length;
      console.log(`[SIGNALING] ${userId} desconectado (conexiones restantes: ${remainingConnections})`);
      
      // Si el usuario no tiene más conexiones, eliminarlo y notificar
      if (remainingConnections === 0) {
        delete rooms[roomId].users[userId];
        io.to(roomId).emit('user-left', { userId });
      } else {
        // Notificar al usuario que le quedan menos conexiones
        io.to(roomId).emit('my-connection-count-changed', { userId, count: remainingConnections });
      }
      
      // Mantenemos la sala en memoria aunque quede vacía para conservar el historial.
    }
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

chatHistoryReady.then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`--- SERVIDOR SIGNALING DESPLEGADO ---`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`Signaling: ws://localhost:${PORT}`);
  });
});