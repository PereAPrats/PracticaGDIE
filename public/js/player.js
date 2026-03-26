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
    const settingsWrapper = document.getElementById("settingsWrapper");
    const settingsToggle = document.getElementById("settingsToggle");
    const settingsMenu = document.getElementById("settingsMenu");
    const subtitlesCurrent = document.getElementById("subtitlesCurrent");
    const audioCurrent = document.getElementById("audioCurrent");
    const qualityCurrent = document.getElementById("qualityCurrent");
    const trackEs = document.getElementById("trackEs");
    const statusDisplay = document.getElementById("videoStatus");
    const chaptersList = document.getElementById("chaptersList");
    const chaptersTitle = document.getElementById("chaptersTitle");
    const metadataLangToggle = document.getElementById("metadataLangToggle");
    const metadataLangCurrent = document.getElementById("metadataLangCurrent");
    const metadataTrackElement = document.getElementById("pistas");
    const playerContainer = video.closest(".video-player");
    const controlsOverlay = playerContainer?.querySelector(".video-controls");
    

    const FULLSCREEN_UI_TIMEOUT_MS = 1800;

    let chapterItems = [];
    let fsUiTimer = null;
    let currentMetadataLang = "es";
    let currentSubtitleLang = "off";
    let currentAudioLang = "off";
    let currentQuality = "1080p";
    let dashPlayer = null; // Instancia para MPEG-DASH
    let hlsPlayer = null;  // Instancia para HLS

    const isPlayerFullscreen = () => {
        return document.fullscreenElement === playerContainer;
    };

    const clearFsUiTimer = () => {
        if (fsUiTimer) {
            clearTimeout(fsUiTimer);
            fsUiTimer = null;
        }
    };

    const showFsUi = () => {
        if (!playerContainer || !isPlayerFullscreen()) return;
        playerContainer.classList.add("fs-ui-visible");
    };

    const hideFsUi = () => {
        if (!playerContainer || !isPlayerFullscreen()) return;
        playerContainer.classList.remove("fs-ui-visible");
    };

    const scheduleFsUiHide = () => {
        if (!isPlayerFullscreen()) return;

        clearFsUiTimer();
        fsUiTimer = setTimeout(() => {
            hideFsUi();
        }, FULLSCREEN_UI_TIMEOUT_MS);
    };

    const handleFullscreenActivity = () => {
        if (!isPlayerFullscreen()) return;
        showFsUi();
        scheduleFsUiHide();
    };

    const parseTimestampToSeconds = (value) => {
        const trimmed = String(value).trim();
        const parts = trimmed.split(":").map((part) => Number(part));

        if (parts.length === 3 && parts.every(Number.isFinite)) {
            const [hh, mm, ss] = parts;
            return (hh * 3600) + (mm * 60) + ss;
        }

        if (parts.length === 2 && parts.every(Number.isFinite)) {
            const [mm, ss] = parts;
            return (mm * 60) + ss;
        }

        return null;
    };

    const parseChaptersVtt = (vttText) => {
        const lines = vttText.split(/\r?\n/);
        const parsed = [];

        let i = 0;
        while (i < lines.length) {
            const rawLine = lines[i].trim();

            if (!rawLine || /^WEBVTT/i.test(rawLine) || /^NOTE/i.test(rawLine) || /^\d+$/.test(rawLine)) {
                i += 1;
                continue;
            }

            if (rawLine.includes("-->") && rawLine.split("-->").length === 2) {
                const [startRaw, endRaw] = rawLine.split("-->").map((part) => part.trim());
                const start = parseTimestampToSeconds(startRaw);
                const end = parseTimestampToSeconds(endRaw);

                i += 1;
                const textLines = [];
                while (i < lines.length && lines[i].trim() !== "") {
                    textLines.push(lines[i].trim());
                    i += 1;
                }

                const title = textLines.join(" ") || `Capitulo ${parsed.length + 1}`;

                if (start !== null && end !== null) {
                    parsed.push({ start, end, title });
                }

                continue;
            }

            i += 1;
        }

        return parsed;
    };

    const setActiveChapter = (currentTime) => {
        if (!chapterItems.length) return;

        const activeIndex = chapterItems.findIndex((chapter) => {
            return currentTime >= chapter.start && currentTime < chapter.end;
        });

        chapterItems.forEach((chapter, index) => {
            chapter.button.classList.toggle("active", index === activeIndex);
        });
    };

    // Función para procesar y limpiar archivos VTT (remover números de ID)
    const loadCleanVTTSubtitles = async (trackElement, vttPath) => {
        try {
            const response = await fetch(vttPath, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const vttText = await response.text();
            const cleanedVTT = vttText
                .split(/\r?\n/)
                .filter((line) => {
                    // Remover líneas que son SOLO números (IDs de capítulo)
                    return !/^\d+$/.test(line.trim());
                })
                .join("\n");

            // Crear un blob con el VTT limpio
            const blob = new Blob([cleanedVTT], { type: "text/vtt;charset=utf-8" });
            const blobUrl = URL.createObjectURL(blob);

            // Asignar el blob URL al track
            trackElement.src = blobUrl;
            trackElement.dispatchEvent(new Event("load"));
        } catch (error) {
            console.error("Error al cargar subtítulos limpios:", error);
            trackElement.dispatchEvent(new Event("error"));
        }
    };

    const renderChapterButtons = (chapters) => {
        if (!chaptersList) return;

        if (!chapters.length) {
            chaptersList.innerHTML = '<p class="chapters-loading">No hay capitulos disponibles.</p>';
            return;
        }

        chaptersList.innerHTML = "";
        chapterItems = chapters.map((chapter, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chapter-btn";
            button.textContent = `${index + 1}. ${chapter.title}`;
            button.addEventListener("click", () => {
                video.currentTime = chapter.start;
                video.play();
                setActiveChapter(chapter.start);
            });
            chaptersList.appendChild(button);

            return { ...chapter, button };
        });
    };

    const getChapterFileByLang = (lang) => {
        return lang === "en" ? "../media/chaptersEng.vtt" : "../media/chaptersEsp.vtt";
    };

    const detectMetadataLangFromSrc = () => {
        const src = (metadataTrackElement?.getAttribute("src") || "").toLowerCase();
        return src.includes("metadataeng") ? "en" : "es";
    };

    const applyMetadataLanguage = (lang) => {
        currentMetadataLang = lang;

        if (chaptersTitle) {
            chaptersTitle.textContent = lang === "en" ? "Chapters" : "Capitulos";
        }

        if (metadataLangCurrent) {
            metadataLangCurrent.textContent = lang.toUpperCase();
        }

        document.dispatchEvent(new CustomEvent("metadata-language-change", {
            detail: { lang }
        }));
    };

    const loadChapters = async (lang = currentMetadataLang) => {
        if (!chaptersList) return;

        try {
            const chapterFile = getChapterFileByLang(lang);
            const response = await fetch(chapterFile, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const vttText = await response.text();
            const chapters = parseChaptersVtt(vttText);
            renderChapterButtons(chapters);
        } catch (error) {
            chaptersList.innerHTML = '<p class="chapters-loading">Error al cargar chapters.vtt</p>';
            console.error("No se pudieron cargar los capitulos:", error);
        }
    };

    if (metadataLangToggle) {
        metadataLangToggle.addEventListener("change", () => {
            const lang = metadataLangToggle.checked ? "en" : "es";
            applyMetadataLanguage(lang);
            loadChapters(lang);
        });
    }

    document.addEventListener("metadata-language-change", (event) => {
        const lang = event?.detail?.lang === "en" ? "en" : "es";

        if (metadataLangToggle) {
            metadataLangToggle.checked = (lang === "en");
        }

        if (metadataLangCurrent) {
            metadataLangCurrent.textContent = lang.toUpperCase();
        }
    });

    // Configuración de rutas de iconos
    const paths = {
        play: "../assets/img/play.svg",
        pause: "../assets/img/pause.svg",
        volumeUp: "../assets/img/volume.svg",
        volumeMute: "../assets/img/mute.svg",
        fullscreen: "../assets/img/expand.svg",
        fullscreenExit: "../assets/img/minim.svg"
    };

    const setSubtitleLanguage = (lang) => {
        currentSubtitleLang = lang;

        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            
            if (track.kind === "subtitles") {
                // "showing" para verlos, "disabled" para ocultarlos
                track.mode = (track.language === lang) ? "showing" : "disabled";
            }
        }

        if (subtitlesCurrent) {
            subtitlesCurrent.textContent = lang === "off" ? "OFF" : lang.toUpperCase();
        }

        // Si selecciona inglés, cargar y limpiar subtítulos en inglés
        if (lang === "en") {
            const trackEn = document.getElementById("trackEn");
            if (trackEn && !trackEn.src?.includes("blob:")) {
                loadCleanVTTSubtitles(trackEn, "../media/subtitlesEng.vtt");
            }
        }
    };

    const setAudioLanguage = (lang) => {
        currentAudioLang = lang;

        if (audioCurrent) {
            audioCurrent.textContent = lang === "off" ? "OFF" : lang.toUpperCase();
        }

        // Placeholder de selector de audio hasta integrar pistas de audio reales
        if (statusDisplay) {
            statusDisplay.textContent = lang === "off"
                ? "Audio desactivado"
                : `Audio seleccionado: ${lang.toUpperCase()}`;

            setTimeout(() => {
                if (statusDisplay.textContent.startsWith("Audio")) {
                    statusDisplay.textContent = "";
                }
            }, 1200);
        }
    };

    // Función para limpiar cualquier reproductor adaptativo activo antes de cambiar la calidad
    const resetAdaptivePlayers = () => {
        if (dashPlayer) {
            dashPlayer.reset();
            dashPlayer = null;
        }
        if (hlsPlayer) {
            hlsPlayer.destroy();
            hlsPlayer = null;
        }
        video.pause();
        video.removeAttribute('src'); // Limpiamos el src de MP4
        video.load()
    };

    const setVideoQuality = (quality) => {
        console.log(`Cambiando calidad a: ${quality}`);
        const currentTime = video.currentTime;
        const isPaused = video.paused;
        
        // Limpiamos cualquier reproductor adaptativo previo
        resetAdaptivePlayers();


        if (quality === "DASH") {
            console.log("Inicializando reproductor MPEG-DASH...");
            // Configuración MPEG-DASH
            dashPlayer = dashjs.MediaPlayer().create();
            dashPlayer.initialize(video, "../assets/videos/dash/manifest.mpd", true);
            dashPlayer.seek(currentTime);
            currentQuality = "DASH";
        } 
        else if (quality === "HLS") {
            console.log("Inicializando reproductor HLS...");
            // Configuración HLS
            if (Hls.isSupported()) {
                hlsPlayer = new Hls();
                hlsPlayer.loadSource("../assets/videos/hls/master.m3u8");
                hlsPlayer.attachMedia(video);
                hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.currentTime = currentTime;
                    if (!isPaused) video.play();
                });
            }
            currentQuality = "HLS";
        }
        else {
            console.log("Cambiando a calidad progresiva (MP4)...");
            // Modo Progresivo (MP4 normal)
            currentQuality = quality;
            video.src = `../assets/videos/mp4/Video_${quality}.mp4`;
            video.load();
            video.onloadedmetadata = () => {
                video.currentTime = currentTime;
                if (!isPaused) video.play();
                video.onloadedmetadata = null;
            };
        }

        if (qualityCurrent) {
            qualityCurrent.textContent = currentQuality.toUpperCase();
        }
    };

    const closeSettingsMenu = () => {
        if (!settingsWrapper || !settingsMenu) return;
        settingsWrapper.classList.remove("open");
        settingsMenu.setAttribute("aria-hidden", "true");
        settingsMenu.querySelectorAll(".settings-item").forEach((item) => {
            item.classList.remove("open");
        });
    };

    const toggleSettingsMenu = () => {
        if (!settingsWrapper || !settingsMenu) return;
        const willOpen = !settingsWrapper.classList.contains("open");
        settingsWrapper.classList.toggle("open", willOpen);
        settingsMenu.setAttribute("aria-hidden", willOpen ? "false" : "true");
    };

    if (settingsToggle) {
        settingsToggle.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleSettingsMenu();
        });
    }

    if (settingsMenu) {
        settingsMenu.addEventListener("click", (event) => {
            event.stopPropagation();

            const mainBtn = event.target.closest(".settings-main-btn");
            if (mainBtn) {
                const item = mainBtn.closest(".settings-item");
                if (!item) return;

                const isOpen = item.classList.contains("open");
                settingsMenu.querySelectorAll(".settings-item").forEach((node) => node.classList.remove("open"));
                item.classList.toggle("open", !isOpen);
                return;
            }

            const optionBtn = event.target.closest(".settings-option");
            if (!optionBtn){
                return;
            }
            const setting = optionBtn.dataset.setting;
            const value = optionBtn.dataset.value;

            if (setting === "subtitles") setSubtitleLanguage(value);
            if (setting === "audio") setAudioLanguage(value);
            if (setting === "quality") setVideoQuality(value);

            settingsMenu.querySelectorAll(`.settings-option[data-setting="${setting}"]`).forEach((btn) => {
                btn.classList.toggle("active", btn.dataset.value === value);
            });

            closeSettingsMenu();
        });
    }

    document.addEventListener("click", () => {
        closeSettingsMenu();
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

        setActiveChapter(video.currentTime);
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

        if (isPlayerFullscreen()) {
            showFsUi();
            scheduleFsUiHide();
        } else {
            clearFsUiTimer();
            playerContainer?.classList.remove("fs-ui-visible");
        }
    });

    if (playerContainer) {
        playerContainer.addEventListener("mousemove", handleFullscreenActivity);
        playerContainer.addEventListener("touchstart", handleFullscreenActivity, { passive: true });
    }

    if (controlsOverlay) {
        controlsOverlay.addEventListener("mousemove", handleFullscreenActivity);
        controlsOverlay.addEventListener("click", handleFullscreenActivity);
        controlsOverlay.addEventListener("input", handleFullscreenActivity);
        controlsOverlay.addEventListener("change", handleFullscreenActivity);
    }

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

    setSubtitleLanguage(currentSubtitleLang);
    setAudioLanguage(currentAudioLang);

    if (settingsMenu) {
        settingsMenu.querySelectorAll(".settings-option").forEach((btn) => {
            const setting = btn.dataset.setting;
            const value = btn.dataset.value;

            if (setting === "subtitles" && value === currentSubtitleLang) btn.classList.add("active");
            if (setting === "audio" && value === currentAudioLang) btn.classList.add("active");
            if (setting === "quality" && value === currentQuality) btn.classList.add("active");
        });
    }

    const initialLang = detectMetadataLangFromSrc();

    if (metadataLangToggle) {
        metadataLangToggle.checked = (initialLang === "en");
    }

    applyMetadataLanguage(initialLang);
    loadChapters(initialLang);
        // Cargar subtítulos limpios (sin números de ID)
    if (trackEs) {
        const subtitlePath = trackEs.getAttribute("src");
        if (subtitlePath) {
            loadCleanVTTSubtitles(trackEs, subtitlePath);
        }
    }
});