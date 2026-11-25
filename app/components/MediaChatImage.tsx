"use client";

import { ExternalLink, Download, X, ChevronLeft, ChevronRight } from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type Props = {
  imageUrl: string;
  alt?: string;
  className?: string;
  align?: "left" | "right" | "center";
  tile?: boolean;
  galleryUrls?: string[];
};

const imagePath =
  /^\/api\/images\/([0-9a-f-]{36})\.(png|jpg|webp|gif)$/i;

export default function MediaChatImage({
  imageUrl,
  alt = "Изображение",
  className,
  align = "left",
  tile = false,
  galleryUrls,
}: Props) {
  const [open, setOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState(imageUrl);
  const gallery = useMemo(() => galleryUrls?.length ? galleryUrls : [imageUrl], [galleryUrls, imageUrl]);
  const currentIndex = gallery.indexOf(viewerUrl);
  const [closing, setClosing] = useState(false);

  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const previewFailed = failedPreviewUrl === imageUrl;

  const match = imagePath.exec(imageUrl);

  const previewUrl = match
    ? `/api/images/previews/${match[1]}.webp`
    : imageUrl;

  const viewerMatch = imagePath.exec(viewerUrl);
  const downloadUrl = viewerMatch
    ? `/api/images/download/${viewerMatch[1]}.${viewerMatch[2]}`
    : viewerUrl;

  useEffect(() => {
    if (!open || closing || currentIndex < 0) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setClosing(true);
      } else if (gallery.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = Math.max(0, Math.min(gallery.length - 1, currentIndex + (event.key === "ArrowLeft" ? -1 : 1)));
        setViewerUrl(gallery[next]);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, closing, gallery, currentIndex]);

  function closeViewer() {
  if (!closing) {
    setClosing(true);
  }
}
  
  return (
    <>
        <style>{`
      @keyframes mediaViewerFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes mediaViewerFadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      @keyframes mediaViewerZoomIn {
        from {
          opacity: 0;
          transform: scale(0.94);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes mediaViewerZoomOut {
        from {
          opacity: 1;
          transform: scale(1);
        }
        to {
          opacity: 0;
          transform: scale(0.96);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .media-viewer-overlay,
        .media-viewer-image {
          animation-duration: 1ms !important;
        }
      }
        
        .media-viewer-toolbar {
        position: absolute;
        bottom: calc(18px + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;

        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;

        background: rgba(35, 38, 48, 0.85);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);

        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
        }

        .media-viewer-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;

        width: 44px;
        height: 44px;
        padding: 0;

        background: transparent;
        color: white;
        border: none;
        border-radius: 50%;

        cursor: pointer;
        text-decoration: none;

        transition:
            background-color 160ms ease,
            transform 160ms ease;
        }

        .media-viewer-action:hover {
        background: rgba(255, 255, 255, 0.14);
        transform: translateY(-2px);
        }

        .media-viewer-action:active {
        transform: scale(0.94);
        }

        .media-viewer-action:focus-visible {
        outline: 2px solid #b6a4ff;
        outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
        .media-viewer-action {
            transition: none;
        }

        .media-viewer-action:hover,
        .media-viewer-action:active {
            transform: none;
        }
        }

    `}</style>
      <button
        type="button"
        onClick={() => { setViewerUrl(imageUrl); setClosing(false); setOpen(true); }}
        aria-label="Открыть изображение"
        className={className}
        style={{
          display: "block",
          cursor: "zoom-in",
          padding: 0,
          border: 0,
          background: "none",
          marginInline: align === "center" ? "auto" : undefined,
          width: tile ? "100%" : undefined,
          aspectRatio: tile ? "1" : undefined,
          overflow: tile ? "hidden" : undefined,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            previewFailed
              ? imageUrl
              : previewUrl
          }
          onError={() => setFailedPreviewUrl(imageUrl)}
          alt={alt}
          loading="lazy"
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight: tile ? "none" : 340,
            width: tile ? "100%" : "auto",
            height: tile ? "100%" : "auto",
            objectFit: tile ? "cover" : undefined,
            borderRadius: 8,
            marginLeft: align !== "left" ? "auto" : 0,
            marginRight: align !== "right" ? "auto" : 0,
          }}
        />
      </button>

      {open && currentIndex >= 0 && (
        
        <div
        role="dialog"
        aria-modal="true"
        aria-label="Просмотр изображения"
        className="media-viewer-overlay"
        onAnimationEnd={(event) => {
            if (
            closing &&
            event.target === event.currentTarget
            ) {
            setOpen(false);
            setClosing(false);
            }
        }}
        onClick={(event) => {
            if (event.target === event.currentTarget) {
            closeViewer();
            }
        }}
        style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: 16,
            animation: closing
            ? "mediaViewerFadeOut 200ms ease-in both"
            : "mediaViewerFadeIn 220ms ease-out both",
        }}
        >

        
{gallery.length > 1 && <div aria-live="polite" style={{ position: 'absolute', top: 24, color: '#ccc', fontSize: 14 }}>{currentIndex + 1} / {gallery.length}</div>}
<div className="media-viewer-toolbar">
  {gallery.length > 1 && <button type="button" className="media-viewer-action" aria-label="Предыдущее изображение" title="Предыдущее изображение (←)" disabled={currentIndex <= 0} style={{ opacity: currentIndex <= 0 ? .35 : 1 }} onClick={() => setViewerUrl(gallery[currentIndex - 1])}><ChevronLeft size={24} /></button>}
  <a
    href={viewerUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="media-viewer-action"
    title="Открыть оригинал"
    aria-label="Открыть оригинал"
  >
    <ExternalLink size={22} strokeWidth={1.8} />
  </a>

  <a
    href={downloadUrl}
    className="media-viewer-action"
    title="Скачать оригинал"
    aria-label="Скачать оригинал"
  >
    <Download size={22} strokeWidth={1.8} />
  </a>

  <button
    type="button"
    onClick={closeViewer}
    className="media-viewer-action"
    title="Закрыть просмотр"
    aria-label="Закрыть просмотр"
  >
    <X size={24} strokeWidth={1.8} />
  </button>
  {gallery.length > 1 && <button type="button" className="media-viewer-action" aria-label="Следующее изображение" title="Следующее изображение (→)" disabled={currentIndex >= gallery.length - 1} style={{ opacity: currentIndex >= gallery.length - 1 ? .35 : 1 }} onClick={() => setViewerUrl(gallery[currentIndex + 1])}><ChevronRight size={24} /></button>}
</div>


          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewerUrl}
            className="media-viewer-image"
            alt={gallery.length > 1 ? `Изображение ${currentIndex + 1} из ${gallery.length}` : alt}
            style={{
              display: "block",
              maxWidth: "96vw",
              maxHeight: "min(82vh, calc(100dvh - 180px))",
              objectFit: "contain",
              animation: closing
            ? "mediaViewerZoomOut 180ms ease-in both"
            : "mediaViewerZoomIn 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
            }}
          />
        </div>
      )}
    </>
  );
}

