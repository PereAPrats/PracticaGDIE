document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('videoPlayer');
    const overlay = document.getElementById('videoOverlay');
    const quizContent = document.getElementById('quizContent');
    const textContainer = document.getElementById('roomDescription');
    const nameContainer = document.getElementById('roomName');

    let metadataTrack;
    let quizLanzado = false;

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
        overlay.style.display = 'flex'; 
        quizContent.innerHTML = `
            <h2 style="margin-bottom: 20px;">${quiz.pregunta}</h2>
            <div style="display: flex; gap: 15px; justify-content: center;">
                ${quiz.opciones.map((opt, i) => `
                    <button class="btn-quiz" 
                            style="padding: 10px 20px; cursor: pointer; background: white; border: none; border-radius: 5px; color: #2d5a27; font-weight: bold;"
                            onclick="window.responder(${i}, ${quiz.correcta}, ${restartTime})">
                        ${opt}
                    </button>
                `).join('')}
            </div>
        `;
    }

    // Definición global para los botones
    window.responder = (seleccion, correcta, reinicio) => {
        overlay.style.display = 'none';
        if (seleccion === correcta) {
            alert("¡Correcto!");
            // Dejamos quizLanzado en true para que pueda seguir avanzando
            video.play();
        } else {
            alert("Incorrecto. Repitiendo escena...");
            quizLanzado = false; // IMPORTANTE: Permitir que el quiz se reactive al volver a pasar
            video.currentTime = reinicio;
            video.play();
        }
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