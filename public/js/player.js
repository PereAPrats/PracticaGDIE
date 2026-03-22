/**
 * PLAYER CORE - Paso 1: Player HTML mínimo estable
 * Gestión de reproducción directa, UI personalizada y errores.
 */

// Función auxiliar para formatear tiempo (00:00)
const formatTime = (seconds) => {
    if (isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, "0")}`;
};

document.addEventListener("DOMContentLoaded", () => {
    // Referencias al DOM
    const video = document.getElementById("videoPlayer");
    const playBtn = document.getElementById("playPause");
    const playIcon = document.getElementById("playIcon");
    const muteBtn = document.getElementById("mute");
    const muteIcon = document.getElementById("muteIcon");
    const fullscreenBtn = document.getElementById("fullscreen");
    const fsIcon = document.getElementById("fsIcon");
    const back10 = document.getElementById("back10");
    const forward10 = document.getElementById("forward10");
    const progress = document.getElementById("progress");
    const timeDisplay = document.getElementById("time");
    const status = document.getElementById("videoStatus");
    const subtitleSelect = document.getElementById("subtitles");
    const trackEs = document.getElementById("trackEs");
const statusDisplay = document.getElementById("videoStatus");

    // Configuración de rutas de iconos
    const paths = {
        play: "../assets/img/play.svg",
        pause: "../assets/img/pause.svg",
        volumeUp: "../assets/img/volume.svg",
        volumeMute: "../assets/img/mute.svg",
        fullscreen: "../assets/img/expand.svg",
        fullscreenExit: "../assets/img/minim.svg"
    };

    subtitleSelect.addEventListener("change", (e) => {
        const lang = e.target.value; // 'es', 'en' o 'off'
        
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            
            if (track.kind === "subtitles") {
                // "showing" para verlos, "disabled" para ocultarlos
                track.mode = (track.language === lang) ? "showing" : "disabled";
            }
        }
    });

    // --- CONTROL DE REPRODUCCIÓN ---
    playBtn.addEventListener("click", () => {
        video.paused ? video.play() : video.pause();
    });

    video.addEventListener("play", () => playIcon.src = paths.pause);
    video.addEventListener("pause", () => playIcon.src = paths.play);

    // --- NAVEGACIÓN Y PROGRESO ---
    forward10.addEventListener("click", () => {
        if (!isNaN(video.duration)) video.currentTime = Math.min(video.currentTime + 10, video.duration);
    });

    back10.addEventListener("click", () => {
        video.currentTime = Math.max(video.currentTime - 10, 0);
    });

    video.addEventListener("timeupdate", () => {
        if (!isNaN(video.duration)) {
            progress.value = video.currentTime;
            timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
        }
    });

    video.addEventListener("loadedmetadata", () => {
        progress.max = video.duration;
        timeDisplay.textContent = `0:00 / ${formatTime(video.duration)}`;
    });

    progress.addEventListener("input", () => {
        video.currentTime = progress.value;
    });

    // --- VOLUMEN Y FULLSCREEN ---
    muteBtn.addEventListener("click", () => {
        video.muted = !video.muted;
        muteIcon.src = video.muted ? paths.volumeMute : paths.volumeUp;
    });

    fullscreenBtn.addEventListener("click", () => {
        const container = video.closest('.video-player');
        if (!document.fullscreenElement) {
            container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
        } else {
            document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        }
    });

    document.addEventListener("fullscreenchange", () => {
        fsIcon.src = document.fullscreenElement ? paths.fullscreenExit : paths.fullscreen;
    });

    // --- GESTIÓN EXPLÍCITA DE ERRORES Y ESTADOS ---

    // Evento 'error' en la pista de subtítulos
    trackEs.addEventListener("error", () => {
        // Si el archivo no carga (404) o el MIME type no es text/vtt
        statusDisplay.textContent = "ERROR: No se pudo cargar el archivo de subtítulos (VTT).";
        statusDisplay.style.color = "red";
        console.error("Fallo en la carga de: " + trackEs.src);
    });

    // Evento 'load' para confirmar carga exitosa
    trackEs.addEventListener("load", () => {
        console.log("Subtítulos cargados correctamente y listos.");
        // Opcional: limpiar mensajes previos si la carga fue exitosa
        if (statusDisplay.textContent.includes("VTT")) {
            statusDisplay.textContent = "";
        }
    });

    // Implementación de los estados mínimos requeridos: LOADING, READY, ERROR
    video.addEventListener("waiting", () => {
        status.textContent = "Cargando buffer...";
        status.style.color = "orange";
    });

    video.addEventListener("playing", () => {
        status.textContent = ""; // Limpiar mensajes al reproducir
    });

    video.addEventListener("error", () => {
        const err = video.error;
        let message = "Error desconocido de video.";
        
        // Switch de errores según la API de HTML5[cite: 1]
        switch (err.code) {
            case 1: message = "Proceso de carga abortado por el usuario."; break;
            case 2: message = "Error de red al descargar el video."; break;
            case 3: message = "Error de decodificación: el archivo está corrupto o el códec no es compatible."; break;
            case 4: message = "El formato de video no es compatible con este navegador."; break;
        }
        status.textContent = `CRITICAL ERROR: ${message}`;
        status.style.color = "red";
    });

    video.addEventListener("stalled", () => {
        status.textContent = "La red está demasiado lenta. Reintentando...";
    });
});