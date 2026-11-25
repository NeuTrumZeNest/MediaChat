export const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_INSPECTED_DOCUMENT_SIZE = 25 * 1024 * 1024;
export const DOCUMENT_UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
export const DOCUMENT_MIME = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
export type KnownDocumentExtension = keyof typeof DOCUMENT_MIME;
export type DocumentExtension = string;
export function isKnownDocumentExtension(extension: string): extension is KnownDocumentExtension {
  return Object.hasOwn(DOCUMENT_MIME, extension);
}
export function documentMimeType(extension: string, size = 0): string {
  return size <= MAX_INSPECTED_DOCUMENT_SIZE && isKnownDocumentExtension(extension) ? DOCUMENT_MIME[extension] : 'application/octet-stream';
}
export function documentStorageExtension(extension: string): string {
  return isKnownDocumentExtension(extension) ? extension : 'bin';
}
export const DOCUMENT_ACCEPT = ""; // Любой файл; неизвестные типы выдаются только для скачивания.


export type DocumentInfo = { url: string; originalName: string; extension: DocumentExtension; mimeType: string; size: number };
