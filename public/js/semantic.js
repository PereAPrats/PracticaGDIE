// Capa semántica: carga metadatos VTT, actualiza texto/mapa en tiempo real y lanza quizzes interactivos.
// Mantiene sincronía con el idioma de metadatos y controla la lógica de respuestas del usuario.

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('videoPlayer');
    const overlay = document.getElementById('videoOverlay');
    const quizContent = document.getElementById('quizContent');
    const textContainer = document.getElementById('roomDescription');
    const nameContainer = document.getElementById('roomName');
    const statusContainer = document.getElementById('videoStatus');

    let metadataCues = []; // Almacenar metadata parseado manualmente
    let quizLanzado = false;
    let cueActualKey = null;
    let feedbackTimer = null;

    const PLACEHOLDERS = {
        es: {
            roomName: 'Esperando...',
            roomDescription: 'Cargando información del recorrido...'
        },
        en: {
            roomName: 'Waiting...',
            roomDescription: 'Loading tour information...'
        }
    };

    function normalizarCueData(rawData) {
        if (!rawData || typeof rawData !== 'object') {
            return null;
        }

        const hasSchema = typeof rawData.type === 'string'
            && typeof rawData.action === 'string'
            && rawData.payload
            && typeof rawData.payload === 'object';

        if (hasSchema) {
            return rawData;
        }

        // Compatibilidad hacia atras para cues antiguos sin el esquema requerido.
        return {
            type: 'metadata',
            action: 'render-room',
            payload: rawData
        };
    }

    // Parsear VTT manualmente
    // Parseamos cues JSON embebidos en VTT para usarlos como fuente de estado de la UI.
    function parseMetadataVTT(vttText) {
        const lines = vttText.split(/\r?\n/);
        const cues = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();

            // Buscar línea con timestamp
            if (line.includes('-->')) {
                const [startStr, endStr] = line.split('-->').map(t => t.trim());
                const startTime = parseTimeToSeconds(startStr);
                const endTime = parseTimeToSeconds(endStr);

                i++;
                let jsonText = '';
                let braceCount = 0;

                // Leer el JSON completo
                while (i < lines.length) {
                    const jsonLine = lines[i];
                    jsonText += jsonLine + '\n';

                    braceCount += (jsonLine.match(/{/g) || []).length;
                    braceCount -= (jsonLine.match(/}/g) || []).length;

                    i++;
                    // Terminar cuando cerramos todas las braces
                    if (braceCount === 0 && jsonText.includes('{')) {
                        break;
                    }
                }

                try {
                    const data = JSON.parse(jsonText);
                    const cueData = normalizarCueData(data);
                    if (cueData) {
                        cues.push({ startTime, endTime, data: cueData });
                    }
                } catch (e) {
                    console.error('Error parseando JSON:', jsonText.substring(0, 50), e);
                }
            } else {
                i++;
            }
        }

        return cues;
    }

    function parseTimeToSeconds(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length === 3) {
            const [hh, mm, ss] = parts.map(Number);
            return hh * 3600 + mm * 60 + ss;
        } else if (parts.length === 2) {
            const [mm, ss] = parts.map(Number);
            return mm * 60 + ss;
        }
        return 0;
    }

    // Cargar metadata VTT
    async function loadMetadata(lang = 'es') {
        const file = lang === 'en' ? '/media/metadataEng.vtt' : '/media/metadataEsp.vtt';

        try {
            const response = await fetch(file, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const vttText = await response.text();
            metadataCues = parseMetadataVTT(vttText);
            console.log(`Metadata cargado en ${lang}: ${metadataCues.length} cues`);
        } catch (error) {
            console.error(`Error cargando metadata ${lang}:`, error);
            metadataCues = [];
        }
    }

    function hayCueActivo() {
        return metadataCues.some(c => video.currentTime >= c.startTime && video.currentTime < c.endTime);
    }

    function actualizarPlaceholdersIdioma(lang) {
        const idioma = lang === 'en' ? 'en' : 'es';
        const destino = PLACEHOLDERS[idioma];

        if (nameContainer) {
            const textoActual = (nameContainer.innerText || '').trim();
            const esPlaceholder = textoActual === PLACEHOLDERS.es.roomName || textoActual === PLACEHOLDERS.en.roomName || textoActual === '';
            if (esPlaceholder || !hayCueActivo()) {
                nameContainer.innerText = destino.roomName;
            }
        }

        if (textContainer) {
            const textoActual = (textContainer.innerText || '').trim();
            const esPlaceholder = textoActual === PLACEHOLDERS.es.roomDescription || textoActual === PLACEHOLDERS.en.roomDescription || textoActual === '';
            if (esPlaceholder || !hayCueActivo()) {
                textContainer.innerText = destino.roomDescription;
            }
        }
    }

    function mostrarFeedback(mensaje) {
        if (!statusContainer || !mensaje) return;

        statusContainer.textContent = mensaje;
        statusContainer.style.color = '#ffffff';

        if (feedbackTimer) clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
            if (statusContainer.textContent === mensaje) {
                statusContainer.textContent = '';
                statusContainer.style.color = '';
            }
        }, 1300);
    }

    // Cargar metadata al inicio
    video.addEventListener('loadedmetadata', () => {
        console.log('loadedmetadata disparado');
        loadMetadata('es');
        actualizarPlaceholdersIdioma('es');
    });

    // Cambio de idioma
    document.addEventListener('metadata-language-change', (event) => {
        const lang = event?.detail?.lang === 'en' ? 'en' : 'es';
        console.log(`Cambiando metadata a ${lang}`);
        loadMetadata(lang);
        actualizarPlaceholdersIdioma(lang);
    });

    // 2. Monitor de tiempo (Interfaz y Quiz)
    video.addEventListener('timeupdate', () => {
        // Buscar cue activo en el array parseado
        const activeCue = metadataCues.find(c => video.currentTime >= c.startTime && video.currentTime < c.endTime);

        if (!activeCue) {
            // Si no hay cue activa, soltamos la llave para que el quiz pueda rearmarse al volver a entrar.
            cueActualKey = null;
            return;
        }

        const nuevoCueKey = `${activeCue.startTime}-${activeCue.endTime}`;

        if (cueActualKey !== nuevoCueKey) {
            cueActualKey = nuevoCueKey;
            quizLanzado = false;
        }

        const cueData = activeCue.data;
        if (cueData.action !== 'render-room') return;
        const payload = cueData.payload || {};

        // Actualizar Interfaz
        if (nameContainer) nameContainer.innerText = payload.Name || payload.Nombre || "";
        if (textContainer) textContainer.innerText = payload.Descripcion || "";
        if (payload.Room) actualizarMapa(payload.Room);

        // Lógica del Quiz
        const pool = payload.quiz_pool || payload.quizz_pool;
        if (pool && pool.length > 0) {
            // Si llegamos al final de la habitación y no hemos preguntado
            if (video.currentTime >= activeCue.endTime - 0.5 && !quizLanzado) {
                quizLanzado = true;
                video.pause();
                mostrarQuizEnVideo(pool, activeCue.startTime);
            }
        }
    });

    // Mostramos una pregunta del pool al final del cue activo y pausamos reproducción.
    function mostrarQuizEnVideo(pool, restartTime) {
        const quiz = pool[Math.floor(Math.random() * pool.length)];
        if (!quiz || !Array.isArray(quiz.opciones) || quiz.opciones.length === 0) return;

        overlay.style.display = 'flex'; 
        quizContent.innerHTML = `
            <h2 class="quiz-title">${quiz.pregunta}</h2>
            <div class="quiz-options">
                ${quiz.opciones.map((opt, i) => `
                    <button class="btn-quiz btn-quiz-option"
                            data-index="${i}">
                        ${obtenerTextoOpcion(opt)}
                    </button>
                `).join('')}
            </div>
        `;

        quizContent.querySelectorAll('.btn-quiz').forEach((btn) => {
            btn.addEventListener('click', () => {
                const seleccion = Number(btn.dataset.index);
                window.responder(seleccion, quiz, restartTime);
            });
        });
    }

    function obtenerTextoOpcion(opcion) {
        if (typeof opcion === 'string') return opcion;
        if (opcion && typeof opcion === 'object') {
            return opcion.texto || opcion.label || opcion.text || '';
        }
        return '';
    }

    function parsearTiempoDestino(valor) {
        if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
        if (typeof valor === 'string') {
            const limpio = valor.trim();
            const numero = Number(limpio);
            if (Number.isFinite(numero)) return numero;

            const partes = limpio.split(':');
            if (partes.length === 2 || partes.length === 3) {
                const numeros = partes.map((p) => Number(p));
                if (numeros.every((n) => Number.isFinite(n))) {
                    if (partes.length === 2) {
                        const [mm, ss] = numeros;
                        return (mm * 60) + ss;
                    }

                    const [hh, mm, ss] = numeros;
                    return (hh * 3600) + (mm * 60) + ss;
                }
            }
        }
        return null;
    }

    // Resolvemos acción por prioridad: regla de opción, regla global y fallback por correcta/incorrecta.
    function resolverAccionRespuesta(quiz, seleccion) {
        const opcionSeleccionada = Array.isArray(quiz.opciones) ? quiz.opciones[seleccion] : null;

        if (opcionSeleccionada && typeof opcionSeleccionada === 'object') {
            const accionOpcion = opcionSeleccionada.accion || opcionSeleccionada.action;
            const destinoOpcion = parsearTiempoDestino(
                opcionSeleccionada.destino ?? opcionSeleccionada.goto ?? opcionSeleccionada.time
            );

            if (accionOpcion === 'goto' && destinoOpcion !== null) return { tipo: 'goto', destino: destinoOpcion };
            if (accionOpcion === 'repeat') return { tipo: 'repeat' };
            if (accionOpcion === 'continue') return { tipo: 'continue' };
        }

        const esCorrecta = seleccion === quiz.correcta;
        const regla = esCorrecta ? (quiz.onCorrect || quiz.on_correct) : (quiz.onWrong || quiz.on_wrong);

        if (regla && typeof regla === 'object') {
            const accionRegla = regla.accion || regla.action;
            const destinoRegla = parsearTiempoDestino(regla.destino ?? regla.goto ?? regla.time);

            if (accionRegla === 'goto' && destinoRegla !== null) return { tipo: 'goto', destino: destinoRegla };
            if (accionRegla === 'repeat') return { tipo: 'repeat' };
            if (accionRegla === 'continue') return { tipo: 'continue' };
        }

        return esCorrecta ? { tipo: 'continue' } : { tipo: 'repeat' };
    }

    // Definición global para los botones
    window.responder = (seleccion, quiz, reinicio) => {
        overlay.style.display = 'none';
        const accion = resolverAccionRespuesta(quiz, seleccion);

        if (accion.tipo === 'repeat') {
            mostrarFeedback('Respuesta incorrecta. Repitiendo escena...');
            quizLanzado = false;
            video.currentTime = reinicio;
            video.play();
            return;
        }

        if (accion.tipo === 'goto') {
            mostrarFeedback('Saltando al siguiente capitulo...');
            quizLanzado = false;
            cueActualKey = null;
            video.currentTime = accion.destino;
            video.play();
            return;
        }

        if (Number.isInteger(quiz.correcta)) {
            mostrarFeedback(seleccion === quiz.correcta ? 'Correcto!' : 'Continuando...');
        }

        video.play();
    };

    function actualizarMapa(roomId) {
        const svgObject = document.getElementById('houseMap');
        if (svgObject && svgObject.contentDocument) {
            const svgDoc = svgObject.contentDocument;
            const elementos = svgDoc.querySelectorAll('*');
            elementos.forEach(el => {
                const label = el.getAttribute('inkscape:label');
                if (label) {
                    el.style.fill = (label === roomId) ? "#09782e" : "#ffffff";
                }
            });
        }
    }
});