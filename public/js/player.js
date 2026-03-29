// Controla la reproducción base con MP4 directo, UI personalizada y eventos QoE.
// También expone una API mínima para que el módulo MSE (Paso 4) reutilice estado y telemetría.

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
    const qualityCurrent = document.getElementById("qualityCurrent");
    const trackEs = document.getElementById("trackEs");
    const trackEn = document.getElementById("trackEn");
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
    let currentQuality = "1080p";
    // Identificador único por sesión para correlacionar eventos cliente-servidor.
    const sessionId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `sid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sessionStartTs = performance.now();
    let startupPending = true;
    let startupTimeMs = null;
    let rebufferCount = 0;
    let sessionEnded = false;

    // Añadimos sid a las URLs de recursos para trazabilidad de peticiones.
    const appendSessionId = (url) => {
        try {
            const nextUrl = new URL(url, window.location.origin);
            nextUrl.searchParams.set("sid", sessionId);
            return `${nextUrl.pathname}${nextUrl.search}`;
        } catch (_error) {
            return url;
        }
    };

    // Enviamos telemetría QoE sin bloquear la reproducción.
    const emitTelemetry = (eventName, payload = {}, options = {}) => {
        const body = {
            event: eventName,
            session_id: sessionId,
            ts: new Date().toISOString(),
            page: window.location.pathname,
            video_time: Number(video?.currentTime || 0),
            quality: currentQuality,
            subtitles: currentSubtitleLang,
            ...payload
        };

        console.log("[QOE]", body);

        const endpoint = "/api/telemetry";
        const serialized = JSON.stringify(body);
        if (options.useBeacon && navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, serialized);
            return;
        }

        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: serialized,
            keepalive: true
        }).catch(() => {
            // Silenciamos errores de telemetría para no interferir con la reproducción.
        });
    };

    // Cerramos la sesión con un resumen de KPIs principales.
    const reportSessionSummary = (reason) => {
        const duration = Number(video?.duration || 0);
        const watched = Number(video?.currentTime || 0);
        const completion = duration > 0 ? Number((watched / duration).toFixed(4)) : 0;

        emitTelemetry("session_summary", {
            reason,
            startup_time_ms: startupTimeMs,
            rebuffer_count: rebufferCount,
            watched_seconds: watched,
            completion_ratio: completion
        }, { useBeacon: true });
    };

    const baseSrc = video?.getAttribute("src");
    if (baseSrc) {
        video.src = appendSessionId(baseSrc);
    }

    emitTelemetry("session_start", {
        initial_src: video?.getAttribute("src") || "",
        user_agent: navigator.userAgent
    });

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

    const applySubtitleTrackMode = (lang) => {
        const matchingTracks = [];

        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (track.kind !== "subtitles") continue;

            if (lang === "off") {
                track.mode = "disabled";
                continue;
            }

            const language = (track.language || "").toLowerCase();
            const label = (track.label || "").toLowerCase();
            const isSpanish = language.startsWith("es") || label.includes("espa");
            const isEnglish = language.startsWith("en") || label.includes("eng");
            const shouldShow = (lang === "es" && isSpanish) || (lang === "en" && isEnglish);

            if (shouldShow) {
                matchingTracks.push(track);
                // hidden fuerza la carga de cues antes de mostrar.
                track.mode = "hidden";
            } else {
                track.mode = "disabled";
            }
        }

        if (lang !== "off" && matchingTracks.length) {
            // Forzar refresco del track activo para evitar que HLS quede "mudo".
            requestAnimationFrame(() => {
                matchingTracks[0].mode = "showing";
            });
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
        return lang === "en" ? "/media/chaptersEng.vtt" : "/media/chaptersEsp.vtt";
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
        play: "/assets/img/play.svg",
        pause: "/assets/img/pause.svg",
        volumeUp: "/assets/img/volume.svg",
        volumeMute: "/assets/img/mute.svg",
        fullscreen: "/assets/img/expand.svg",
        fullscreenExit: "/assets/img/minim.svg"
    };

    const setSubtitleLanguage = (lang) => {
        currentSubtitleLang = lang;

        if (subtitlesCurrent) {
            subtitlesCurrent.textContent = lang === "off" ? "OFF" : lang.toUpperCase();
        }

        applySubtitleTrackMode(lang);
    };

    const updateQualityUI = (quality) => {
        currentQuality = quality;
        if (qualityCurrent) {
            qualityCurrent.textContent = currentQuality.toUpperCase();
        }
    };

    // Compartimos API mínima para que el módulo MSE gestione motores sin duplicar lógica base.
    window.playerCore = {
        video,
        trackEs,
        trackEn,
        status,
        applySubtitleTrackMode,
        getCurrentSubtitleLang: () => currentSubtitleLang,
        updateQualityUI,
        sessionId,
        appendSessionId,
        emitTelemetry
    };

    const setSettingsMenuState = (isOpen, options = {}) => {
        if (!settingsWrapper || !settingsMenu) return;

        const { restoreFocus = true } = options;
        const activeElement = document.activeElement;
        const focusedInsideMenu = !!(activeElement && settingsMenu.contains(activeElement));

        if (!isOpen && restoreFocus && focusedInsideMenu) {
            settingsToggle?.focus();
        }

        settingsWrapper.classList.toggle("open", isOpen);
        settingsMenu.setAttribute("aria-hidden", isOpen ? "false" : "true");

        if (settingsToggle) {
            settingsToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        }

        if (isOpen) {
            settingsMenu.removeAttribute("inert");
        } else {
            settingsMenu.setAttribute("inert", "");
            settingsMenu.querySelectorAll(".settings-item").forEach((item) => {
                item.classList.remove("open");
            });
        }
    };

    const closeSettingsMenu = (options = {}) => {
        setSettingsMenuState(false, options);
    };

    const toggleSettingsMenu = () => {
        if (!settingsWrapper || !settingsMenu) return;
        const willOpen = !settingsWrapper.classList.contains("open");
        setSettingsMenuState(willOpen);
    };

    // Sync initial accessibility state with markup.
    setSettingsMenuState(false, { restoreFocus: false });

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
            if (setting === "quality") window.mseController?.setVideoQuality(value);

            settingsMenu.querySelectorAll(`.settings-option[data-setting="${setting}"]`).forEach((btn) => {
                btn.classList.toggle("active", btn.dataset.value === value);
            });

            closeSettingsMenu();
        });
    }

    document.addEventListener("click", () => {
        closeSettingsMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeSettingsMenu();
        }
    });

    // --- CONTROL DE REPRODUCCIÓN ---
    playBtn.addEventListener("click", () => {
        video.paused ? video.play() : video.pause();
    });

    video.addEventListener("play", () => {
        playIcon.src = paths.pause;
        if (startupPending) {
            startupPending = false;
            startupTimeMs = Math.round(performance.now() - sessionStartTs);
            emitTelemetry("startup_time", { startup_time_ms: startupTimeMs });
        }
        emitTelemetry("play");
    });

    video.addEventListener("pause", () => {
        playIcon.src = paths.play;
        emitTelemetry("pause");
    });

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

    video.addEventListener("seeking", () => {
        emitTelemetry("seeking", { target_time: Number(video.currentTime.toFixed(2)) });
    });

    video.addEventListener("seeked", () => {
        emitTelemetry("seeked", { target_time: Number(video.currentTime.toFixed(2)) });
    });

    // --- VOLUMEN Y FULLSCREEN ---
    muteBtn.addEventListener("click", () => {
        video.muted = !video.muted;
        muteIcon.src = video.muted ? paths.volumeMute : paths.volumeUp;
    });

    fullscreenBtn.addEventListener("click", () => {
        if (!document.fullscreenElement) {
            playerContainer?.requestFullscreen?.() || playerContainer?.webkitRequestFullscreen?.();
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

    const bindSubtitleTrackStatus = (trackElement) => {
        if (!trackElement) return;

        trackElement.addEventListener("error", () => {
            // Si el archivo no carga (404) o el MIME type no es text/vtt
            status.textContent = "ERROR: No se pudo cargar el archivo de subtítulos (VTT).";
            status.style.color = "red";
            console.error("Fallo en la carga de:", trackElement.src);
        });

        trackElement.addEventListener("load", () => {
            if (status.textContent.includes("VTT")) {
                status.textContent = "";
            }
        });
    };

    bindSubtitleTrackStatus(trackEs);
    bindSubtitleTrackStatus(trackEn);

    // Implementación de los estados mínimos requeridos: LOADING, READY, ERROR
    video.addEventListener("waiting", () => {
        status.textContent = "Cargando buffer...";
        status.style.color = "orange";
        rebufferCount += 1;
        emitTelemetry("rebuffering", { rebuffer_count: rebufferCount });
    });

    video.addEventListener("playing", () => {
        status.textContent = ""; // Limpiar mensajes al reproducir
        emitTelemetry("playing");
    });

    video.addEventListener("error", () => {
        const err = video.error;
        if (!err) return;
        let message = "Error desconocido de video.";
        
        // Mapeamos los códigos de error estándar de la API de video HTML5.
        switch (err.code) {
            case 1: message = "Proceso de carga abortado por el usuario."; break;
            case 2: message = "Error de red al descargar el video."; break;
            case 3: message = "Error de decodificación: el archivo está corrupto o el códec no es compatible."; break;
            case 4: message = "El formato de video no es compatible con este navegador."; break;
        }
        status.textContent = `CRITICAL ERROR: ${message}`;
        status.style.color = "red";
        emitTelemetry("error", { code: err.code, message });
    });

    video.addEventListener("stalled", () => {
        status.textContent = "La red está demasiado lenta. Reintentando...";
        emitTelemetry("stalled");
    });

    video.addEventListener("ended", () => {
        sessionEnded = true;
        emitTelemetry("ended");
        reportSessionSummary("ended");
    });

    window.addEventListener("beforeunload", () => {
        if (!sessionEnded) {
            const duration = Number(video?.duration || 0);
            const watched = Number(video?.currentTime || 0);
            const completion = duration > 0 ? watched / duration : 0;
            emitTelemetry("abandon", {
                watched_seconds: watched,
                completion_ratio: Number(completion.toFixed(4))
            }, { useBeacon: true });
            reportSessionSummary("abandon");
        }
    });

    setSubtitleLanguage(currentSubtitleLang);

    if (settingsMenu) {
        settingsMenu.querySelectorAll(".settings-option").forEach((btn) => {
            const setting = btn.dataset.setting;
            const value = btn.dataset.value;

            if (setting === "subtitles" && value === currentSubtitleLang) btn.classList.add("active");
            if (setting === "quality" && value === currentQuality) btn.classList.add("active");
        });
    }

    const initialLang = detectMetadataLangFromSrc();

    if (metadataLangToggle) {
        metadataLangToggle.checked = (initialLang === "en");
    }

    applyMetadataLanguage(initialLang);
    loadChapters(initialLang);

    updateQualityUI(currentQuality);
});