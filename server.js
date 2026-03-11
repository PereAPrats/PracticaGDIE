const express = require('express');
const path = require('path');
const app = express();
const PORT = 80;

// 1. Configuración de tipos MIME usando un middleware antes de servir los estáticos
const staticOptions = {
  setHeaders: function (res, filePath) {
    // Subtítulos (Paso 2)
    if (filePath.endsWith('.vtt')) {
      res.setHeader('Content-Type', 'text/vtt');
    }
    // Fragmentos de vídeo DASH (Paso 4)
    if (filePath.endsWith('.m4s')) {
      res.setHeader('Content-Type', 'video/iso.segment'); 
    }
    // Manifiesto DASH (Paso 4)
    if (filePath.endsWith('.mpd')) {
      res.setHeader('Content-Type', 'application/dash+xml');
    }
    // Metadatos (Paso 3 y 5)
    if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
    // Permitir CORS (útil si probáis cosas desde diferentes dominios)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
};

// 2. Servir archivos de la carpeta 'public' con la configuración anterior
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// Escuchar en 0.0.0.0 para ser accesible desde internet
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- SERVIDOR GDIE DESPLEGADO ---`);
    console.log(`URL: http://gdie2607.ltim.uib.es`);
    console.log(`Puerto: ${PORT}`);
});