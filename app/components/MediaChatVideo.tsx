"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Download, Maximize, Minimize, Pause, Play, Repeat1, RotateCcw, RotateCw, Volume2, VolumeX, X } from "lucide-react";
import { readMediaVolume, saveMediaVolume } from "../../src/lib/media-volume";
import { readMediaRepeat, saveMediaRepeat } from "../../src/lib/media-repeat";
import type { VideoInfo } from "../../src/lib/video-types";
import styles from "./MediaChatVideo.module.css";

function formatTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.floor(Math.max(0, value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function MediaChatVideo({ video, onOpen }: { video: VideoInfo; onOpen?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const lastAudibleVolumeRef = useRef(1);
  const ownsFullscreenRef = useRef(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.duration);
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [posterFailed, setPosterFailed] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const button = previewButtonRef.current;
    if (!button) return;
    const observer = new IntersectionObserver(([entry]) => setPreviewVisible(entry.isIntersecting), { threshold: .2 });
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preview = previewVideoRef.current;
    if (!preview) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function syncPreview() {
      if (!preview) return;
      if (previewVisible && !active && !document.hidden && !motion.matches) {
        preview.defaultMuted = true;
        preview.muted = true;
        preview.setAttribute("muted", "");
        preview.playsInline = true;
        void preview.play().catch(() => {}); // При запрете autoplay остаётся миниатюра.
      } else preview.pause();
    }
    syncPreview();
    document.addEventListener("visibilitychange", syncPreview);
    motion.addEventListener("change", syncPreview);
    return () => {
      preview.pause();
      document.removeEventListener("visibilitychange", syncPreview);
      motion.removeEventListener("change", syncPreview);
    };
  }, [previewVisible, previewFailed, active]);

  useEffect(() => {
    if (!active) return;
    const element = videoRef.current;
    const changed = () => setFullscreen(document.fullscreenElement === viewerSurfaceRef.current);
    const nativeBegin = () => setFullscreen(true);
    const nativeEnd = () => setFullscreen(false);
    document.addEventListener("fullscreenchange", changed);
    element?.addEventListener("webkitbeginfullscreen", nativeBegin);
    element?.addEventListener("webkitendfullscreen", nativeEnd);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      element?.removeEventListener("webkitbeginfullscreen", nativeBegin);
      element?.removeEventListener("webkitendfullscreen", nativeEnd);
      if (ownsFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      ownsFullscreenRef.current = false;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const surface = viewerSurfaceRef.current;
    const heading = headingRef.current;
    const toolbar = toolbarRef.current;
    if (!surface || !heading || !toolbar) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hoveringControls = false;
    let keyboardNavigation = false;
    function armHide() {
      clearTimeout(timer);
      if (!playing || waiting || error) return;
      timer = setTimeout(() => {
        const focused = keyboardNavigation && (heading?.contains(document.activeElement) || toolbar?.contains(document.activeElement));
        const hovered = window.matchMedia("(hover: hover)").matches && (heading?.matches(":hover") || toolbar?.matches(":hover"));
        if (!hoveringControls && !hovered && !focused) {
          if (heading?.contains(document.activeElement) || toolbar?.contains(document.activeElement)) surface?.focus({ preventScroll: true });
          setControlsShown(false);
        }
      }, 2000);
    }
    function reveal() { setControlsShown(true); armHide(); }
    function pointerActivity() { keyboardNavigation = false; reveal(); }
    function keyboardActivity(event: KeyboardEvent) {
      keyboardNavigation = true;
      if (surface?.dataset.controlsVisible === "false") {
        flushSync(() => setControlsShown(true));
        if (event.key === "Tab") {
          event.preventDefault();
          const items = toolbar?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          const target = event.shiftKey ? items?.[items.length - 1] : items?.[0];
          target?.focus();
        }
      }
      armHide();
    }
    function enterControls(event: PointerEvent) { if (event.pointerType === "touch") return; hoveringControls = true; reveal(); }
    function leaveControls() { hoveringControls = false; armHide(); }
    surface.addEventListener("pointermove", pointerActivity);
    surface.addEventListener("pointerdown", pointerActivity);
    surface.addEventListener("focusout", armHide);
    document.addEventListener("keydown", keyboardActivity);
    document.addEventListener("fullscreenchange", reveal);
    for (const element of [heading, toolbar]) {
      element.addEventListener("pointerenter", enterControls);
      element.addEventListener("pointerleave", leaveControls);
    }
    armHide();
    return () => {
      clearTimeout(timer);
      surface.removeEventListener("pointermove", pointerActivity);
      surface.removeEventListener("pointerdown", pointerActivity);
      surface.removeEventListener("focusout", armHide);
      document.removeEventListener("keydown", keyboardActivity);
      document.removeEventListener("fullscreenchange", reveal);
      for (const element of [heading, toolbar]) {
        element.removeEventListener("pointerenter", enterControls);
        element.removeEventListener("pointerleave", leaveControls);
      }
    };
  }, [active, playing, waiting, error]);

  const controlsVisible = controlsShown || !playing || waiting || Boolean(error);

  async function toggleFullscreen() {
    const element = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
      webkitDisplayingFullscreen?: boolean;
    }) | null;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        ownsFullscreenRef.current = false;
      } else if (element?.webkitDisplayingFullscreen) {
        element.webkitExitFullscreen?.();
      } else if (document.fullscreenEnabled && viewerSurfaceRef.current?.requestFullscreen) {
        // Полноэкранным становится контейнер видео и управления, а не страница под dialog.
        await viewerSurfaceRef.current.requestFullscreen();
        ownsFullscreenRef.current = true;
        if (!dialogRef.current?.open) {
          await document.exitFullscreen();
          ownsFullscreenRef.current = false;
        }
      } else if (element?.webkitEnterFullscreen) {
        element.webkitEnterFullscreen();
      } else {
        setError("Полноэкранный режим недоступен в этом браузере.");
      }
    } catch (failure) {
      console.warn("Fullscreen request failed:", failure);
      setError("Браузер не разрешил переключить полноэкранный режим. Попробуйте ещё раз.");
    }
  }

  async function play() {
    const element = videoRef.current;
    if (!element) return;
    setError("");
    const codecType = video.videoCodec === "h264" ? 'video/mp4; codecs="avc1"' : `video/webm; codecs="${video.videoCodec}"`;
    if (!element.canPlayType(codecType)) {
      setError("Этот браузер не поддерживает кодек видео. Скачайте оригинал или откройте чат в совместимом браузере.");
      return;
    }
    try { await element.play(); }
    catch (failure) {
      if ((failure as Error).name === "AbortError") return;
      setError((failure as Error).name === "NotAllowedError" ? "Браузер остановил воспроизведение. Нажмите Play ещё раз." : "Не удалось воспроизвести видео. Возможно, кодек не поддерживается или соединение прервано.");
    }
  }

  function start() {
    // Создаём video и вызываем play в исходном пользовательском жесте (важно для Safari).
    onOpen?.();
    previewVideoRef.current?.pause();
    setRepeat(readMediaRepeat("video"));
    const savedVolume = readMediaVolume("video");
    setVolume(savedVolume);
    if (savedVolume > 0) lastAudibleVolumeRef.current = savedVolume;
    setControlsShown(true);
    flushSync(() => setActive(true));
    dialogRef.current?.showModal();
    if (videoRef.current) videoRef.current.volume = savedVolume;
    void play();
  }

  function seek(value: number) {
    if (!videoRef.current || !ready) return;
    const next = Math.max(0, Math.min(value, duration));
    videoRef.current.currentTime = next;
    setTime(next);
  }

  function close() {
    videoRef.current?.pause();
    if (ownsFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    ownsFullscreenRef.current = false;
    setFullscreen(false);
    dialogRef.current?.close();
    setActive(false);
    setPlaying(false);
    setTime(0);
    setReady(false);
    setWaiting(false);
    setError("");
    requestAnimationFrame(() => previewButtonRef.current?.focus({ preventScroll: true }));
  }

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) { close(); return; }
    const element = videoRef.current;
    if (!element || event.target !== element) return;
    // object-fit: contain оставляет поля внутри самого video-элемента.
    // Закрываем по этим полям, но не по видимой картинке ролика.
    const box = element.getBoundingClientRect();
    const width = element.videoWidth || video.width;
    const height = element.videoHeight || video.height;
    const scale = Math.min(box.width / width, box.height / height);
    const left = box.left + (box.width - width * scale) / 2;
    const top = box.top + (box.height - height * scale) / 2;
    if (event.clientX < left || event.clientX > left + width * scale ||
        event.clientY < top || event.clientY > top + height * scale) close();
  }

  return (
    <section className={styles.message} aria-label={`Видео: ${video.originalName}`}>
      <button ref={previewButtonRef} type="button" className={styles.preview} style={{ aspectRatio: `${video.width} / ${video.height}` }} onClick={start} aria-label={`Открыть видео ${video.originalName}`}>
        {!posterFailed && <img src={video.posterUrl} alt="" loading="lazy" decoding="async" onError={() => setPosterFailed(true)} /> /* eslint-disable-line @next/next/no-img-element */}
        {previewVisible && !previewFailed && <video ref={previewVideoRef} src={video.url} poster={video.posterUrl} muted autoPlay={!active} loop playsInline preload="metadata"
          disablePictureInPicture disableRemotePlayback aria-hidden="true" tabIndex={-1}
          onError={() => setPreviewFailed(true)}
          />}
        <span className={styles.overlayPlay}><Play size={25} fill="currentColor" /></span>
        <span className={styles.duration} aria-label={`Длительность ${formatTime(video.duration)}`}>{formatTime(video.duration)}</span>
      </button>
      {active && <dialog ref={dialogRef} className={styles.viewer} aria-label={`Просмотр видео: ${video.originalName}`}
        onKeyDownCapture={(event) => {
          const isSpace = event.code === "Space" || event.key === " ";
          const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          if ((!isSpace && !direction) || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          const target = event.target;
          if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, input:not([type="range"])'))) return;
          event.preventDefault();
          setControlsShown(true);
          if (direction) {
            seek((videoRef.current?.currentTime || 0) + direction * 15);
            return; // Общий keyboard-обработчик обновит таймер видимости бара.
          }
          event.stopPropagation();
          if (event.repeat) return;
          if (videoRef.current?.paused) void play();
          else videoRef.current?.pause();
        }}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={viewerSurfaceRef} className={styles.viewerSurface} data-video-viewer-surface="true" tabIndex={-1} data-controls-visible={controlsVisible}>
        <div ref={headingRef} className={styles.heading} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <span className={styles.name} title={video.originalName}>{video.originalName}</span>
          <button type="button" className={`${styles.iconButton} ${repeat ? styles.repeatActive : ""}`} aria-label="Повтор видео" aria-pressed={repeat} title={repeat ? "Выключить повтор видео" : "Включить повтор видео"} onClick={() => {
            const next = !repeat;
            setRepeat(next);
            saveMediaRepeat("video", next);
            if (videoRef.current) videoRef.current.loop = next;
          }}><Repeat1 size={20} /></button>
          <a href={`${video.url}?download=1`} download={video.originalName} className={styles.iconButton} aria-label={`Скачать видео ${video.originalName}`} title="Скачать оригинал"><Download size={20} /></a>
          <button type="button" className={styles.iconButton} onClick={close} aria-label="Остановить и закрыть видео" title="Закрыть видео" autoFocus><X size={24} /></button>
        </div>
        <div className={styles.stage} onClick={onStageClick}>
          <video ref={videoRef} src={video.url} poster={video.posterUrl} preload="metadata" playsInline
          disablePictureInPicture disableRemotePlayback controlsList="nofullscreen noremoteplayback" loop={repeat} muted={muted}
          aria-label={video.originalName}
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) { setDuration(value); setReady(true); }
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlaying={() => { setPlaying(true); setWaiting(false); }}
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); setWaiting(false); }}
          onWaiting={() => setWaiting(true)} onCanPlay={() => setWaiting(false)}
          onEnded={() => { setPlaying(false); setWaiting(false); }}
          onVolumeChange={(event) => {
            const value = event.currentTarget.volume;
            if (value > 0) lastAudibleVolumeRef.current = value;
            setVolume(value); setMuted(event.currentTarget.muted);
            saveMediaVolume("video", value);
          }}
          onError={() => { setPlaying(false); setWaiting(false); setError("Видео недоступно, повреждено или его кодек не поддерживается браузером. Можно попробовать скачать оригинал."); }}
          />
          {waiting && <span className={styles.loading} role="status">Загрузка видео…</span>}
        </div>
        <div ref={toolbarRef} className={styles.body}>
          <div className={styles.timeline}>
            <span>{formatTime(time)}</span>
            <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration || 1)} disabled={!ready} aria-label="Позиция видео" aria-valuetext={`${formatTime(time)} из ${formatTime(duration)}`} onChange={(event) => seek(Number(event.target.value))} />
            <span>{formatTime(duration)}</span>
          </div>
          <div className={styles.controls}>
            <div className={styles.volume}>
              <button type="button" className={styles.iconButton} aria-label={muted || volume === 0 ? "Включить звук видео" : "Выключить звук видео"} onClick={() => {
                const next = !(muted || volume === 0);
                if (videoRef.current) {
                  if (!next && volume === 0) { videoRef.current.volume = lastAudibleVolumeRef.current; setVolume(lastAudibleVolumeRef.current); saveMediaVolume("video", lastAudibleVolumeRef.current); }
                  videoRef.current.muted = next;
                }
                setMuted(next);
              }}>{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
              <input type="range" min={0} max={1} step={0.01} value={volume} aria-label="Громкость видео" onChange={(event) => {
                const next = Number(event.target.value); setVolume(next); saveMediaVolume("video", next);
                if (videoRef.current) { videoRef.current.volume = next; if (next > 0) { videoRef.current.muted = false; setMuted(false); } }
              }} />
            </div>
            <div className={styles.transport}>
              <button type="button" className={styles.skip} disabled={!ready} onClick={() => seek((videoRef.current?.currentTime || 0) - 15)} aria-label="Видео назад на 15 секунд" title="Назад на 15 секунд"><RotateCcw size={28} /><span>15</span></button>
              <button type="button" className={styles.play} onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} aria-label={playing ? "Пауза видео" : "Продолжить видео"}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
              <button type="button" className={styles.skip} disabled={!ready} onClick={() => seek((videoRef.current?.currentTime || 0) + 15)} aria-label="Видео вперёд на 15 секунд" title="Вперёд на 15 секунд"><RotateCw size={28} /><span>15</span></button>
            </div>
            <div className={styles.fullscreenActions}>
              <button type="button" className={styles.iconButton} aria-label={fullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный просмотр"} title={fullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный просмотр"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button>
            </div>

          </div>
          {error && <div role="alert" className={styles.error}>{error}</div>}
        </div>
        </div>
      </dialog>}
    </section>
  );
}
