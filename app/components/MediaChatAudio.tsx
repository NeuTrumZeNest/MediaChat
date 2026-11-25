"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play, Repeat1, RotateCcw, RotateCw, Volume2, X } from "lucide-react";
import { readMediaVolume, saveMediaVolume } from "../../src/lib/media-volume";
import { readMediaRepeat, saveMediaRepeat } from "../../src/lib/media-repeat";
import styles from "./MediaChatAudio.module.css";

type Props = {
  audioUrl: string;
  title: string;
  subtitle?: string;
  autoPlay?: boolean;
  onClose?: () => void;
};

function formatTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.floor(Math.max(0, seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type AudioPlayerHandle = { play: () => void; pause: () => void };

export default forwardRef<AudioPlayerHandle, Props>(function MediaChatAudio({ audioUrl, title, subtitle, autoPlay = false, onClose }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [repeat, setRepeat] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState("");

  const connectAudio = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    if (!element) return;
    const savedVolume = readMediaVolume("audio");
    element.volume = savedVolume;
    setVolume(savedVolume);
    const savedRepeat = readMediaRepeat("audio");
    element.loop = savedRepeat;
    setRepeat(savedRepeat);
  }, []);

  useImperativeHandle(ref, () => ({
    pause() { audioRef.current?.pause(); },
    play() {
      const audio = audioRef.current;
      if (!audio) return;
      setError("");
      void audio.play().catch(() => setError("Не удалось начать воспроизведение. Нажмите Play, чтобы повторить."));
    },
  }), []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) return audio.pause();
    try {
      setError("");
      await audio.play();
    } catch {
      setError("Не удалось начать воспроизведение. Попробуйте ещё раз.");
    }
  }

  const seekTo = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = Math.max(0, Math.min(value, audio.duration));
    audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select, input:not([type="range"])'))) return;
      // Модальный просмотрщик видео/изображения имеет приоритет над музыкой.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      event.preventDefault();
      seekTo(audio.currentTime + direction * 15);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [seekTo]);

  function updateDuration() {
    const value = audioRef.current?.duration ?? 0;
    setDuration(Number.isFinite(value) && value > 0 ? value : 0);
  }

  return (
    <section className={styles.player} aria-label="Музыкальный плеер">
      <audio ref={connectAudio} src={audioUrl} preload="metadata" autoPlay={autoPlay} loop={repeat}
        onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onVolumeChange={(event) => {
          const value = event.currentTarget.volume;
          setVolume(value);
          saveMediaVolume("audio", value);
        }}
        onPlay={() => { setPlaying(true); setError(""); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setPlaying(false); setError("Файл недоступен или формат не поддерживается"); }}
      />
      <div className={styles.track}>
        <div className={styles.metadata}>
          <div className={styles.title} title={title}>{title}</div>
          <div className={styles.subtitle}>{subtitle || "Media Chat · Музыка"}</div>
        </div>
      </div>
      <div className={styles.transport}>
        <div className={styles.buttons}>
          <button type="button" className={styles.skip} disabled={!duration} onClick={() => seekTo((audioRef.current?.currentTime ?? 0) - 15)} aria-label="Назад на 15 секунд" title="Назад на 15 секунд"><RotateCcw size={30} /><span>15</span></button>
          <button type="button" className={styles.play} onClick={togglePlayback} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button type="button" className={styles.skip} disabled={!duration} onClick={() => seekTo((audioRef.current?.currentTime ?? 0) + 15)} aria-label="Вперёд на 15 секунд" title="Вперёд на 15 секунд"><RotateCw size={30} /><span>15</span></button>
        </div>
        <div className={styles.timeline}>
          <span>{formatTime(currentTime)}</span>
          <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration || 1)} disabled={!duration} aria-label="Позиция воспроизведения" aria-valuetext={`${formatTime(currentTime)} из ${formatTime(duration)}`} onChange={(event) => seekTo(Number(event.target.value))} />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={repeat ? styles.repeatActive : undefined} aria-label="Повтор трека" aria-pressed={repeat} title={repeat ? "Выключить повтор трека" : "Включить повтор трека"} onClick={() => {
          const next = !repeat;
          setRepeat(next);
          saveMediaRepeat("audio", next);
          if (audioRef.current) audioRef.current.loop = next;
        }}><Repeat1 size={20} /></button>
        <label className={styles.volume}><Volume2 size={18} aria-hidden="true" /><input type="range" min={0} max={1} step={0.01} value={volume} aria-label="Громкость" onChange={(event) => { const value = Number(event.target.value); setVolume(value); saveMediaVolume("audio", value); if (audioRef.current) audioRef.current.volume = value; }} /></label>
        {onClose && <button type="button" onClick={onClose} aria-label="Закрыть плеер" title="Закрыть плеер"><X size={18} /></button>}
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>
  );
});
