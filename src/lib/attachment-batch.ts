import { UploadHttpError } from "./upload-error.ts";
import { MAX_IMAGE_SIZE } from "./image-types.ts";
import { MAX_ALBUM_IMAGES } from './image-albums.ts';
import { MAX_DOCUMENT_SIZE } from './document-types.ts';
import { validateVideoSelection } from './video-types.ts';
import { uploadVideo } from './upload-video.ts';
import { uploadDocument } from './upload-document.ts';

export type AttachmentKind = 'image' | 'audio' | 'video' | 'document';
export type DraftAttachment = { id: string; file: File; kind: AttachmentKind; url?: string; asFile?: boolean };
export const SELECTION_LIMITS = { image: Infinity, audio: 20, video: 10, document: 20 } as const;

export function validateAttachmentSelection(files: File[], kind: AttachmentKind) {
  if (files.length > SELECTION_LIMITS[kind]) throw new Error(`За один раз можно выбрать до ${SELECTION_LIMITS[kind]} файлов этого типа.`);
  for (const file of files) {
    let error = '';
    if (kind === 'image') {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) error = 'Выберите PNG, JPG, WebP или GIF.';
      else if (!file.size || file.size > MAX_IMAGE_SIZE) error = 'Размер изображения должен быть от 1 байта до 25 МБ.';
    } else if (kind === 'audio') {
      if (!/\.(mp3|wav|flac)$/i.test(file.name)) error = 'Выберите MP3, WAV или FLAC.';
      else if (!file.size || file.size > 50 * 1024 * 1024) error = 'Размер аудиофайла должен быть от 1 байта до 50 МБ.';
    } else if (kind === 'document') {
      if (!file.size || file.size > MAX_DOCUMENT_SIZE) error = 'Размер файла должен быть от 1 байта до 2 ГБ.';
    } else {
      try { validateVideoSelection(file.name, file.type, file.size); }
      catch (cause) { error = (cause as Error).message; }
    }
    if (error) throw new Error(`${file.name}: ${error}`);
  }
}

// Проверяем файлы независимо: один отказ не сбрасывает весь выбор.
export function partitionAttachmentSelection(files: File[], kind: AttachmentKind): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [], errors: string[] = [];
  for (const file of files) {
    try {
      validateAttachmentSelection([file], kind);
      if (accepted.length >= SELECTION_LIMITS[kind]) {
        errors.push(`${file.name}: за один раз можно выбрать до ${SELECTION_LIMITS[kind]} файлов этого типа.`);
      } else accepted.push(file);
    } catch (error) { errors.push((error as Error).message); }
  }
  return { accepted, errors };
}

export function attachmentKindForFile(file: File, requested: AttachmentKind): AttachmentKind {
  const supported = requested === 'image' ? /\.(png|jpe?g|webp|gif)$/i : requested === 'audio' ? /\.(mp3|wav|flac)$/i : /\.(mp4|webm)$/i;
  if (requested === 'document' || !supported.test(file.name)) return 'document';
  try { validateAttachmentSelection([file], requested); return requested; }
  catch { return 'document'; }
}

export function appendAttachmentSelection(current: DraftAttachment[], files: File[], requested: AttachmentKind, createId: () => string) {
  const items = [...current], errors: string[] = [];
  const counts = { image: 0, audio: 0, video: 0, document: 0 };
  for (const item of current) counts[item.kind]++;
  for (const file of files) {
    const kind = attachmentKindForFile(file, requested);
    try {
      validateAttachmentSelection([file], kind);
      if (counts[kind] >= SELECTION_LIMITS[kind]) throw new Error(`${file.name}: в очереди допускается до ${SELECTION_LIMITS[kind]} файлов этого типа.`);
      items.push({ id: createId(), kind, file });
      counts[kind]++;
    } catch (error) { errors.push((error as Error).message); }
  }
  return { items, errors };
}

export function groupAttachments<T extends { kind: AttachmentKind }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.kind === 'image' && last?.[0].kind === 'image' && last.length < MAX_ALBUM_IMAGES) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

async function uploadAsSelected(item: DraftAttachment, progress: (percent: number) => void): Promise<string> {
  if (item.url) { progress(100); return item.url; }
  if (item.kind === 'video') return uploadVideo(item.file, progress);
  if (item.kind === 'document') return uploadDocument(item.file, progress, item.asFile);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const field = item.kind;
    const key = field === 'image' ? 'imageUrl' : 'audioUrl';
    request.open('POST', field === 'image' ? '/api/upload' : '/api/audio/upload');
    request.responseType = 'json';
    request.timeout = 120_000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300 && request.response?.[key]) resolve(request.response[key]);
      else reject(new UploadHttpError(request.response?.error || 'Не удалось загрузить файл', request.status));
    };
    request.onerror = () => reject(new Error('Соединение прервано при загрузке файла'));
    request.ontimeout = () => reject(new Error('Время загрузки истекло. Попробуйте снова.'));
    const form = new FormData(); form.append(field, item.file); request.send(form);
  });
}


export function canFallbackToFile(error: unknown, item: DraftAttachment): boolean {
  if (!(error instanceof UploadHttpError) || item.asFile || !item.file.size || item.file.size > MAX_DOCUMENT_SIZE) return false;
  return [413, 415, 422].includes(error.status) || (item.kind !== 'document' && error.status === 400);
}

export async function uploadAttachment(item: DraftAttachment, progress: (percent: number) => void): Promise<string> {
  try { return await uploadAsSelected(item, progress); }
  catch (error) {
    if (!canFallbackToFile(error, item)) throw error;
    item.kind = 'document';
    item.asFile = true;
    progress(0);
    return uploadDocument(item.file, progress, true);
  }
}
