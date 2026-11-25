"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImageIcon, Music, Paperclip, Video } from "lucide-react";
import { VIDEO_ACCEPT } from "../../src/lib/video-types";
import { DOCUMENT_ACCEPT } from "../../src/lib/document-types";
import styles from "./AttachmentMenu.module.css";

type Props = {
  disabled?: boolean;
  onImage: (files: File[]) => void;
  onAudio: (files: File[]) => void;
  onDocument: (files: File[]) => void;
  onVideo: (files: File[]) => void;
};

export default function AttachmentMenu({ disabled, onImage, onAudio, onDocument, onVideo }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const visible = open && !disabled;

  useEffect(() => {
    if (!visible) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    function outside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible]);

  function choose(input: HTMLInputElement | null) {
    // Открываем диалог в исходном click, до переноса фокуса и закрытия меню.
    input?.click();
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={containerRef} className={styles.container} onBlur={(event) => {
      // Safari может дать relatedTarget=null при mouse click по кнопке.
      // Закрытие в этот момент удаляло пункт до его click и не открывало файл.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" className={styles.trigger} disabled={disabled}
        aria-label="Прикрепить вложение" title="Прикрепить вложение" aria-haspopup="menu" aria-expanded={visible} aria-controls={visible ? menuId : undefined}
        onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}><Paperclip size={23} strokeWidth={1.8} /></button>
      {visible && <div ref={menuRef} id={menuId} role="menu" aria-label="Тип вложения" className={styles.menu}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
          const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || [])];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            items[next]?.focus();
          }
        }}>
        <button type="button" role="menuitem" onClick={() => choose(imageRef.current)}><ImageIcon size={20} /><span>Изображение</span></button>
        <button type="button" role="menuitem" onClick={() => choose(videoRef.current)}><Video size={20} /><span>Видео</span></button>
        <button type="button" role="menuitem" onClick={() => choose(audioRef.current)}><Music size={20} /><span>Музыка</span></button>
        <button type="button" role="menuitem" onClick={() => choose(documentRef.current)}><FileText size={20} /><span>Документ или архив</span></button>
      </div>}
      <input ref={imageRef} type="file" multiple hidden accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { onImage(Array.from(event.target.files || [])); event.target.value = ""; }} />
      <input ref={audioRef} type="file" multiple hidden accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" onChange={(event) => { onAudio(Array.from(event.target.files || [])); event.target.value = ""; }} />
      <input ref={videoRef} type="file" multiple hidden accept={VIDEO_ACCEPT} onChange={(event) => { onVideo(Array.from(event.target.files || [])); event.target.value = ""; }} />
      <input ref={documentRef} type="file" multiple hidden accept={DOCUMENT_ACCEPT} onChange={(event) => { onDocument(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </div>
  );
}
