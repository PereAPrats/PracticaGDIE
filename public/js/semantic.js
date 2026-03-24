document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('videoPlayer');
    const overlay = document.getElementById('videoOverlay');
    const quizContent = document.getElementById('quizContent');
    const textContainer = document.getElementById('roomDescription');
    const nameContainer = document.getElementById('roomName');
    const statusContainer = document.getElementById('videoStatus');

    let metadataTrack;
    let quizLanzado = false;
    let cueActualKey = null;
    let feedbackTimer = null;

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

    // 1. Identificar la pista de metadatos cuando el video esté listo
    video.addEventListener('loadedmetadata', () => {
        metadataTrack = Array.from(video.textTracks).find(t => t.kind === 'metadata');
        if (metadataTrack) {
            metadataTrack.mode = "hidden"; // Asegura que los datos se procesen en segundo plano
        }
    });

    // 2. Monitor de tiempo (Interfaz y Quiz)
    video.addEventListener('timeupdate', () => {
        // PROTECCIÓN: Si metadataTrack aún no existe, no hacemos nada
        if (!metadataTrack || !metadataTrack.activeCues) return;

        const activeCues = metadataTrack.activeCues;
        
        if (activeCues.length > 0) {
            const cue = activeCues[0];
            const nuevoCueKey = `${cue.startTime}-${cue.endTime}`;

            if (cueActualKey !== nuevoCueKey) {
                cueActualKey = nuevoCueKey;
                quizLanzado = false;
            }

            try {
                const data = JSON.parse(cue.text);

                // Actualizar Interfaz
                if (nameContainer) nameContainer.innerText = data.Name || data.Nombre || "";
                if (textContainer) textContainer.innerText = data.Descripcion || "";
                if (data.Room) actualizarMapa(data.Room);

                // Lógica del Quiz
                const pool = data.quiz_pool || data.quizz_pool;
                if (pool && pool.length > 0) {
                    // Si llegamos al final de la habitación y no hemos preguntado
                    if (video.currentTime >= cue.endTime - 0.5 && !quizLanzado) {
                        quizLanzado = true;
                        video.pause();
                        mostrarQuizEnVideo(pool, cue.startTime);
                    }
                }
            } catch (e) {
                console.error("Error al parsear JSON:", e);
            }
        }
    });

    function mostrarQuizEnVideo(pool, restartTime) {
        const quiz = pool[Math.floor(Math.random() * pool.length)];
        if (!quiz || !Array.isArray(quiz.opciones) || quiz.opciones.length === 0) return;

        overlay.style.display = 'flex'; 
        quizContent.innerHTML = `
            <h2 style="margin-bottom: 20px;">${quiz.pregunta}</h2>
            <div style="display: flex; gap: 15px; justify-content: center;">
                ${quiz.opciones.map((opt, i) => `
                    <button class="btn-quiz" 
                            style="padding: 10px 20px; cursor: pointer; background: white; border: none; border-radius: 5px; color: #2d5a27; font-weight: bold;"
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