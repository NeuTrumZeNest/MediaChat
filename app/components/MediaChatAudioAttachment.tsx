"use client";

import { useEffect, useRef, useState } from "react";
import { Music } from "lucide-react";
import styles from "./MediaChatAudioAttachment.module.css";

type Props = {
  audioUrl: string;
  name: string;
  hasText?: boolean;
  onPlay: () => void;
};

export default function MediaChatAudioAttachment({ audioUrl, name, hasText, onPlay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadMetadata, setLoadMetadata] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const extension = audioUrl.split(".").pop()?.toUpperCase() || "АУДИО";
  const title = name.replace(/\.(mp3|wav|flac)$/i, "");

  // Загружаем только метаданные видимых карточек, а не всей истории чата.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLoadMetadata(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px" });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function updateDuration(audio: HTMLAudioElement) {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  }

  const seconds = duration === null ? null : Math.floor(duration);
  const time = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div ref={containerRef} className={styles.attachment} style={{ marginTop: hasText ? 10 : 0 }}>
      {loadMetadata && <audio src={audioUrl} preload="metadata" hidden
        onLoadedMetadata={(event) => updateDuration(event.currentTarget)}
        onDurationChange={(event) => updateDuration(event.currentTarget)}
        onError={() => setFailed(true)} />}
      <button type="button" className={styles.card} onClick={onPlay} aria-label={`Воспроизвести ${name}`}>
        <span className={styles.icon} aria-hidden="true"><Music size={20} strokeWidth={1.5} /></span>
        <span className={styles.details}>
          <span className={styles.heading}>
            <span className={styles.name} title={name}>{title}</span>
            <span className={styles.extension}>{extension}</span>
          </span>
          <span className={styles.duration}>{time ?? (failed ? "Длительность недоступна" : "Определяем длительность…")}</span>
        </span>
      </button>
    </div>
  );
}
