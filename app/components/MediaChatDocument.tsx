import { Archive, Download, File, FileText, FileSpreadsheet, Presentation } from "lucide-react";
import { isKnownDocumentExtension, type DocumentInfo } from "../../src/lib/document-types";
import styles from "./MediaChatDocument.module.css";

export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function MediaChatDocument({ document }: { document: DocumentInfo }) {
  const generic = document.mimeType === "application/octet-stream" || !isKnownDocumentExtension(document.extension);
  const Icon = generic ? File : document.extension === "zip" ? Archive : ["xlsx", "csv"].includes(document.extension) ? FileSpreadsheet : document.extension === "pptx" ? Presentation : FileText;
  return (
    <div className={styles.card}>
      <span className={styles.icon} aria-hidden="true"><Icon size={23} strokeWidth={1.5} fill={generic ? "white" : "none"} color={generic ? "#b9bdc8" : "white"} /></span>
      <span className={styles.details}>
        <span className={styles.name} title={document.originalName}>{document.originalName}</span>
        <span className={styles.caption}>{document.extension ? document.extension.toUpperCase() : "ФАЙЛ"} · {formatFileSize(document.size)}</span>
      </span>
      <a className={styles.download} href={document.url} download={document.originalName} aria-label={`Скачать ${document.originalName}`} title="Скачать оригинал"><Download size={20} /></a>
    </div>
  );
}
