const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// 1. Configuración de tipos MIME usando un middleware antes de servir los estáticos
const staticOptions = {
  setHeaders: function (res, filePath) {
    if (filePath.endsWith('.vtt')) {
      res.setHeader('Content-Type', 'text/vtt');
    }
    if (filePath.endsWith('.m4s')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
    if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
  }
};

// 2. Servir archivos de la carpeta 'public' con la configuración anterior
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

app.listen(PORT, () => {
    console.log(`Servidor listo en http://localhost:${PORT}`);
    console.log(`Tipos MIME configurados para .vtt, .m4s y .json`);
});