// Servidor de origen: expone estáticos de la práctica y métricas QoS/QoE para observabilidad operable.
// Incluye endpoint de telemetría, cálculo de latencias percentiles y trazabilidad por sesión.

const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '256kb' }));

const qosStats = {
  totalRequests: 0,
  statusCounts: {},
  error404: 0,
  error5xx: 0,
  totalBytes: 0,
  latencyMs: []
};

const telemetryEvents = [];
const MAX_TELEMETRY_EVENTS = 500;

const getSessionIdFromRequest = (req) => {
  return req.query.sid || req.get('x-session-id') || req.body?.session_id || 'unknown';
};

const recordLatency = (ms) => {
  qosStats.latencyMs.push(ms);
  if (qosStats.latencyMs.length > 2000) {
    qosStats.latencyMs.shift();
  }
};

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
};

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const statusCode = res.statusCode;
    const sid = getSessionIdFromRequest(req);
    const bytesSent = Number(res.getHeader('content-length') || 0);

    qosStats.totalRequests += 1;
    qosStats.statusCounts[statusCode] = (qosStats.statusCounts[statusCode] || 0) + 1;
    qosStats.totalBytes += bytesSent;
    recordLatency(elapsedMs);

    if (statusCode === 404) qosStats.error404 += 1;
    if (statusCode >= 500) qosStats.error5xx += 1;

    const throughputBps = elapsedMs > 0 ? Math.round((bytesSent * 1000) / elapsedMs) : 0;
    console.log(`[QOS] sid=${sid} ${req.method} ${req.originalUrl} status=${statusCode} latency_ms=${elapsedMs.toFixed(2)} bytes=${bytesSent} throughput_Bps=${throughputBps}`);
  });

  next();
});

app.post('/api/telemetry', (req, res) => {
  const sid = getSessionIdFromRequest(req);
  const event = {
    ...req.body,
    session_id: sid,
    server_ts: new Date().toISOString(),
    ip: req.ip
  };

  telemetryEvents.push(event);
  if (telemetryEvents.length > MAX_TELEMETRY_EVENTS) {
    telemetryEvents.shift();
  }

  console.log(`[QOE] sid=${sid} event=${event.event || 'unknown'} payload=${JSON.stringify(event)}`);
  res.status(204).end();
});

app.get('/api/metrics', (_req, res) => {
  const latencies = qosStats.latencyMs;
  res.json({
    total_requests: qosStats.totalRequests,
    status_counts: qosStats.statusCounts,
    errors_404: qosStats.error404,
    errors_5xx: qosStats.error5xx,
    bytes_sent_total: qosStats.totalBytes,
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99)
    },
    recent_telemetry_events: telemetryEvents.slice(-30)
  });
});

setInterval(() => {
  const p50 = percentile(qosStats.latencyMs, 50);
  const p95 = percentile(qosStats.latencyMs, 95);
  const p99 = percentile(qosStats.latencyMs, 99);
  const avgThroughput = qosStats.totalRequests > 0 ? Math.round(qosStats.totalBytes / qosStats.totalRequests) : 0;
  console.log(`[QOS-SUMMARY] req=${qosStats.totalRequests} 404=${qosStats.error404} 5xx=${qosStats.error5xx} p50=${p50}ms p95=${p95}ms p99=${p99}ms avg_bytes_per_request=${avgThroughput}`);
}, 30000);

// 1. Configuración de tipos MIME usando un middleware antes de servir los estáticos
const staticOptions = {
  setHeaders: function (res, filePath) {
    // Subtítulos
    if (filePath.endsWith('.vtt')) res.setHeader('Content-Type', 'text/vtt');
    // Fragmentos de vídeo DASH
    if (filePath.endsWith('.m4s')) res.setHeader('Content-Type', 'video/iso.segment'); 
    // Manifiesto DASH
    if (filePath.endsWith('.mpd')) res.setHeader('Content-Type', 'application/dash+xml');
    // Metadatos
    if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
    // Permitir CORS (útil si probáis cosas desde diferentes dominios)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
};

// 2. Servir archivos de la carpeta 'public' con la configuración anterior
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// Escuchar en 0.0.0.0 para ser accesible desde internet
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- SERVIDOR GDIE DESPLEGADO ---`);
    console.log(`URL: http://localhost:${PORT}`);
});
