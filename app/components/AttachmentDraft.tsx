"use client";

import { useCallback } from 'react';
import { FileText, Music2, X } from 'lucide-react';
import type { DraftAttachment } from '../../src/lib/attachment-batch';
import { formatFileSize } from './MediaChatDocument';
import styles from './AttachmentDraft.module.css';

function DraftPreview({ item }: { item: DraftAttachment }) {
  const attach = useCallback((node: HTMLImageElement | HTMLVideoElement | null) => {
    if (!node) return;
    const url = URL.createObjectURL(item.file);
    node.src = url;
    return () => {
      if (node instanceof HTMLVideoElement) { node.removeAttribute('src'); node.load(); }
      URL.revokeObjectURL(url);
    };
  }, [item.file]);
  if (item.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="Предпросмотр перед отправкой" ref={attach} />;
  }
  return <video preload="metadata" muted playsInline disablePictureInPicture disableRemotePlayback aria-label="Предпросмотр выбранного видео" ref={attach} />;
}

export default function AttachmentDraft({ items, disabled, onRemove }: {
  items: DraftAttachment[]; disabled: boolean; onRemove: (id: string) => void;
}) {
  if (!items.length) return null;
  return <div className={styles.draft} aria-label="Выбранные вложения">
    {items.length > 1 && <div className={styles.summary}>Выбрано файлов: {items.length}{items.some((item) => item.kind === 'image') ? ' · до 9 фото в альбоме' : ''}</div>}
    <div className={styles.list}>{items.map((item) => <div key={item.id} className={styles.item}>
      {item.kind === 'image' || item.kind === 'video' ? <DraftPreview item={item} /> : item.kind === 'audio' ? <Music2 size={24} /> : <FileText size={24} />}
      <span className={styles.name}>{item.file.name}<small>{formatFileSize(item.file.size)}</small></span>
      <button type="button" disabled={disabled} onClick={() => onRemove(item.id)} aria-label={`Убрать ${item.file.name}`}><X size={17} /></button>
    </div>)}</div>
  </div>;
}
