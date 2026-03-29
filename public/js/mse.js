// Gestiona motores DASH/HLS, cambio de calidad y telemetría de buffer/updateend.
// Se apoya en playerCore para reutilizar estado del player y mantener una sola fuente de verdad.

document.addEventListener("DOMContentLoaded", () => {
    const core = window.playerCore;
    if (!core || !core.video) return;

    const {
        video,
        trackEs,
        trackEn,
        applySubtitleTrackMode,
        getCurrentSubtitleLang,
        updateQualityUI,
        appendSessionId,
        emitTelemetry
    } = core;

    let dashPlayer = null;
    let hlsPlayer = null;
    const subtitleBlobUrls = new Map();
    const UPDATEEND_TELEMETRY_MIN_INTERVAL_MS = 300;
    const BUFFERED_TELEMETRY_MIN_INTERVAL_MS = 500;
    let lastUpdateendTelemetryTs = 0;
    let lastBufferedTelemetryTs = 0;
    let lastBufferedSignature = "";

    // Limitamos la frecuencia de eventos de alto volumen para que los logs sean legibles.
    const emitMseUpdateend = (engine, source) => {
        const now = performance.now();
        if ((now - lastUpdateendTelemetryTs) < UPDATEEND_TELEMETRY_MIN_INTERVAL_MS) {
            return;
        }

        lastUpdateendTelemetryTs = now;
        console.log(`[MSE] ${engine.toUpperCase()} updateend (${source})`);
        emitTelemetry?.("mse_updateend", { engine, source });
    };

    // Registramos rangos de buffer con deduplicación para evitar spam de consola/telemetría.
    const logBufferedRanges = () => {
        if (!video.buffered || video.buffered.length === 0) {
            const now = performance.now();
            if ((now - lastBufferedTelemetryTs) >= BUFFERED_TELEMETRY_MIN_INTERVAL_MS || lastBufferedSignature !== "empty") {
                console.log("[MSE] buffered: empty");
                lastBufferedTelemetryTs = now;
                lastBufferedSignature = "empty";
            }
            return;
        }

        const ranges = [];
        for (let i = 0; i < video.buffered.length; i++) {
            ranges.push(`[${video.buffered.start(i).toFixed(2)}-${video.buffered.end(i).toFixed(2)}]`);
        }

        const signature = ranges.join(" ");
        const now = performance.now();
        const shouldEmit = signature !== lastBufferedSignature || (now - lastBufferedTelemetryTs) >= BUFFERED_TELEMETRY_MIN_INTERVAL_MS;

        if (!shouldEmit) return;

        lastBufferedSignature = signature;
        lastBufferedTelemetryTs = now;
        console.log(`[MSE] buffered: ${signature}`);
        emitTelemetry?.("buffered_ranges", { ranges });
    };

    const bindEngineLogs = () => {
        if (hlsPlayer) {
            hlsPlayer.on(Hls.Events.BUFFER_APPENDED, () => {
                emitMseUpdateend("hls", "buffer_appended");
                logBufferedRanges();
            });

            hlsPlayer.on(Hls.Events.ERROR, (_event, data) => {
                console.error("[MSE] HLS error:", data);
                emitTelemetry?.("mse_error", {
                    engine: "hls",
                    details: data?.details || "unknown",
                    fatal: !!data?.fatal,
                    type: data?.type || "unknown"
                });
            });
        }

        if (dashPlayer) {
            const dashEvents = dashjs.MediaPlayer.events;

            if (dashEvents.ERROR) {
                dashPlayer.on(dashEvents.ERROR, (event) => {
                    console.error("[MSE] DASH error:", event);
                    emitTelemetry?.("mse_error", { engine: "dash", details: event?.error || "unknown" });
                });
            }

            if (dashEvents.FRAGMENT_LOADING_COMPLETED) {
                dashPlayer.on(dashEvents.FRAGMENT_LOADING_COMPLETED, () => {
                    emitMseUpdateend("dash", "fragment_loading_completed");
                    logBufferedRanges();
                });
            }
        }
    };

    const applyCurrentSubtitleMode = () => {
        const lang = getCurrentSubtitleLang?.() || "off";
        applySubtitleTrackMode?.(lang);
    };

    const loadCleanVTTSubtitles = async (trackElement, vttPath) => {
        try {
            const response = await fetch(vttPath, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const vttText = await response.text();
            const cleanedVTT = vttText
                .split(/\r?\n/)
                .filter((line) => !/^\d+$/.test(line.trim()))
                .join("\n");

            const blob = new Blob([cleanedVTT], { type: "text/vtt;charset=utf-8" });
            const blobUrl = URL.createObjectURL(blob);

            const previousBlobUrl = subtitleBlobUrls.get(trackElement.id);
            if (previousBlobUrl) {
                URL.revokeObjectURL(previousBlobUrl);
            }
            subtitleBlobUrls.set(trackElement.id, blobUrl);

            const textTrack = trackElement.track;
            const previousMode = textTrack?.mode;

            if (textTrack) {
                textTrack.mode = "hidden";
            }

            await new Promise((resolve, reject) => {
                const handleLoad = () => {
                    cleanup();
                    resolve();
                };

                const handleError = () => {
                    cleanup();
                    reject(new Error(`No se pudo cargar ${trackElement.id}`));
                };

                const cleanup = () => {
                    trackElement.removeEventListener("load", handleLoad);
                    trackElement.removeEventListener("error", handleError);
                    clearTimeout(timeoutId);
                };

                trackElement.addEventListener("load", handleLoad, { once: true });
                trackElement.addEventListener("error", handleError, { once: true });

                const timeoutId = setTimeout(() => {
                    cleanup();
                    resolve();
                }, 1500);

                trackElement.src = blobUrl;
            });

            if (textTrack) {
                textTrack.mode = previousMode || "disabled";
            }
        } catch (error) {
            console.error("Error al cargar subtitulos limpios:", error);
            throw error;
        }
    };

    const attachTracksToVideo = async () => {
        try {
            if (trackEs) {
                await loadCleanVTTSubtitles(trackEs, appendSessionId ? appendSessionId("/media/subtitlesEsp.vtt") : "/media/subtitlesEsp.vtt");
            }

            if (trackEn) {
                await loadCleanVTTSubtitles(trackEn, appendSessionId ? appendSessionId("/media/subtitlesEng.vtt") : "/media/subtitlesEng.vtt");
            }

            applyCurrentSubtitleMode();
            console.log("Tracks de subtitulos cargados correctamente");
        } catch (error) {
            console.error("Error cargando tracks:", error);
        }
    };

    // Reseteamos el motor activo antes de cambiar de tecnología o representación.
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

        for (let i = 0; i < video.textTracks.length; i++) {
            if (video.textTracks[i].kind === "subtitles") {
                video.textTracks[i].mode = "disabled";
            }
        }

        video.removeAttribute("src");
        video.load();
    };

    const setVideoQuality = (quality) => {
        console.log(`Cambiando calidad a: ${quality}`);
        const currentTime = video.currentTime;
        const isPaused = video.paused;

        resetAdaptivePlayers();

        if (quality === "DASH") {
            console.log("Inicializando reproductor MPEG-DASH...");
            dashPlayer = dashjs.MediaPlayer().create();
            dashPlayer.initialize(video, appendSessionId ? appendSessionId("/assets/videos/dash/manifest.mpd") : "/assets/videos/dash/manifest.mpd", true);
            bindEngineLogs();
            emitTelemetry?.("quality_change", { quality: "DASH", engine: "dash" });

            dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, async () => {
                emitMseUpdateend("dash", "stream_initialized");
                dashPlayer.seek(currentTime);
                await attachTracksToVideo();
                applyCurrentSubtitleMode();
                logBufferedRanges();
                if (!isPaused) video.play();
            });

            updateQualityUI?.("DASH");
            return;
        }

        if (quality === "HLS") {
            console.log("Inicializando reproductor HLS...");
            emitTelemetry?.("quality_change", { quality: "HLS", engine: "hls" });

            if (Hls.isSupported()) {
                hlsPlayer = new Hls();
                hlsPlayer.loadSource(appendSessionId ? appendSessionId("/assets/videos/hls/master.m3u8") : "/assets/videos/hls/master.m3u8");
                hlsPlayer.attachMedia(video);
                bindEngineLogs();

                hlsPlayer.on(Hls.Events.MANIFEST_PARSED, async () => {
                    await attachTracksToVideo();
                    applyCurrentSubtitleMode();
                    video.currentTime = currentTime;
                    logBufferedRanges();
                    if (!isPaused) await video.play();
                });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = appendSessionId ? appendSessionId("/assets/videos/hls/master.m3u8") : "/assets/videos/hls/master.m3u8";
                video.onloadedmetadata = async () => {
                    video.currentTime = currentTime;
                    if (!isPaused) await video.play();
                    video.onloadedmetadata = null;
                    await attachTracksToVideo();
                    applyCurrentSubtitleMode();
                    logBufferedRanges();
                };
            }

            updateQualityUI?.("HLS");
            return;
        }

        console.log("Cambiando a calidad progresiva (MP4)...");
        emitTelemetry?.("quality_change", { quality, engine: "mp4" });
        video.src = appendSessionId
            ? appendSessionId(`/assets/videos/mp4/Video_${quality}.mp4`)
            : `/assets/videos/mp4/Video_${quality}.mp4`;
        video.load();
        video.onloadedmetadata = async () => {
            video.currentTime = currentTime;
            if (!isPaused) video.play();
            video.onloadedmetadata = null;
            await attachTracksToVideo();
            applyCurrentSubtitleMode();
            logBufferedRanges();
        };

        updateQualityUI?.(quality);
    };

    window.mseController = {
        setVideoQuality,
        attachTracksToVideo
    };

    attachTracksToVideo();
});