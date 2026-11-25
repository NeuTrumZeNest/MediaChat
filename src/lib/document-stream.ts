import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputError } from './request-body.ts';
import { documentName, validateDocument } from './document-format.ts';
import { DOCUMENT_DIR } from './document-storage.ts';
import { documentStorageExtension, MAX_DOCUMENT_SIZE, MAX_INSPECTED_DOCUMENT_SIZE, DOCUMENT_UPLOAD_TIMEOUT_MS } from './document-types.ts';

// Ограничение проверяется по фактическим байтам даже без Content-Length.
export async function streamDocumentBody(request: Request, target: string, maxSize = MAX_DOCUMENT_SIZE) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxSize)) {
    throw new InputError('Максимальный размер файла — 2 ГБ', 413);
  }
  if (!request.body) throw new InputError('Выберите файл');
  const file = await open(target, 'wx');
  const reader = request.body.getReader();
  let size = 0, cancelled = false;
  const cancel = () => { cancelled = true; void reader.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, DOCUMENT_UPLOAD_TIMEOUT_MS);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    if (request.signal.aborted) throw new InputError('Загрузка отменена', 408);
    for (;;) {
      const { done, value } = await reader.read();
      if (cancelled || request.signal.aborted) throw new InputError('Загрузка отменена или истекло время ожидания', 408);
      if (done) break;
      size += value.byteLength;
      if (size > maxSize) throw new InputError('Максимальный размер файла — 2 ГБ', 413);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (!bytesWritten) throw new Error('Не удалось записать файл');
        offset += bytesWritten;
      }
    }
    if (!size) throw new InputError('Нельзя отправить пустой файл');
    if (declared !== null && Number(declared) !== size) throw new InputError('Файл загружен не полностью');
    return size;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await file.close();
  }
}

export async function saveStreamedDocument(request: Request, name: string, ownerId: number, asFile = false) {
  const info = documentName(name);
  const id = randomUUID(), filename = `${id}.${asFile ? "bin" : documentStorageExtension(info.extension)}`;
  const staging = join(DOCUMENT_DIR, 'staging');
  await Promise.all([mkdir(staging, { recursive: true }), mkdir(join(DOCUMENT_DIR, 'metadata'), { recursive: true })]);
  const temporary = join(staging, filename), metadataTemporary = join(staging, `${id}.json`);
  const target = join(DOCUMENT_DIR, filename), metadataTarget = join(DOCUMENT_DIR, 'metadata', `${id}.json`);
  let moved = false;
  try {
    const size = await streamDocumentBody(request, temporary);
    // Подробная проверка известных небольших форматов сохранена. Большие файлы
    // передаются как непрозрачные байты: без загрузки в память и распаковки.
    const validated = !asFile && size <= MAX_INSPECTED_DOCUMENT_SIZE
      ? validateDocument(await readFile(temporary), name)
      : { ...info, size, mimeType: 'application/octet-stream' };
    if (request.signal.aborted) throw new InputError('Загрузка отменена', 408);
    const metadata = { ...validated, opaque: asFile, id, filename, ownerId, uploadedAt: new Date().toISOString() };
    await writeFile(metadataTemporary, JSON.stringify(metadata), { flag: 'wx' });
    await rename(temporary, target); moved = true;
    await rename(metadataTemporary, metadataTarget);
    return { url: `/api/documents/${filename}`, ...validated };
  } catch (error) {
    if (moved) await rm(target, { force: true });
    throw error;
  } finally {
    await Promise.all([rm(temporary, { force: true }), rm(metadataTemporary, { force: true })]);
  }
}
