import { inflateRawSync } from "node:zlib";
import { InputError } from "./request-body.ts";

import { documentMimeType, MAX_DOCUMENT_SIZE, MAX_INSPECTED_DOCUMENT_SIZE, type DocumentExtension } from "./document-types.ts";
export { MAX_DOCUMENT_SIZE } from "./document-types.ts";

export function documentName(name: string) {
  if (!name || name !== name.trim() || /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name) ||
      Buffer.byteLength(name, "utf8") > 240 || name.startsWith(".")) {
    throw new InputError("Некорректное имя файла");
  }
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return { originalName: name, extension };

}

// Проверяем структуру ZIP и CRC без распаковки на диск; ограничиваем объём распаковки.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validateZip(buffer: Buffer, extension: DocumentExtension) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new InputError("Архив повреждён", 415);
  const count = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  const centralSize = buffer.readUInt32LE(end + 12);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) ||
      count !== buffer.readUInt16LE(end + 8) || count === 0 || count > 4096 ||
      start + centralSize !== end) throw new InputError("Неподдерживаемая структура ZIP", 415);
  let position = start;
  let inflated = 0;
  const entries = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw new InputError("Архив повреждён", 415);
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const checksum = buffer.readUInt32LE(position + 16);
    const compressed = buffer.readUInt32LE(position + 20);
    const size = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const local = buffer.readUInt32LE(position + 42);
    const next = position + 46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
    if (next > end || local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 ||
        flags & 1 || ![0, 8].includes(method) || inflated + size > 100 * 1024 * 1024 ||
        buffer.readUInt16LE(position + 34) !== 0) throw new InputError("Архив повреждён, зашифрован или слишком большой после распаковки", 415);
    const name = buffer.toString("utf8", position + 46, position + 46 + nameLength);
    if (!name || name.startsWith("/") || name.includes("\\") || name.includes(":") || name.includes("\0") ||
        name.split("/").includes("..") || entries.has(name)) throw new InputError("Небезопасные пути внутри ZIP", 415);
    entries.add(name);
    const localNameLength = buffer.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + buffer.readUInt16LE(local + 28);
    if (buffer.toString("utf8", local + 30, local + 30 + localNameLength) !== name ||
        buffer.readUInt16LE(local + 8) !== method || dataStart + compressed > start || dataStart > start) {
      throw new InputError("Архив повреждён", 415);
    }
    const data = buffer.subarray(dataStart, dataStart + compressed);
    let content: Buffer;
    try { content = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, size) }); }
    catch { throw new InputError("Повреждённое содержимое ZIP", 415); }
    if (content.length !== size || crc32(content) !== checksum) throw new InputError("Контрольная сумма ZIP не совпадает", 415);
    inflated += size;
    position = next;
  }
  if (position !== end) throw new InputError("Архив повреждён", 415);
  const required = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" };
  if (extension !== "zip" && (!entries.has("[Content_Types].xml") || !entries.has("_rels/.rels") ||
      !entries.has(required[extension as keyof typeof required]) || [...entries].some((name) => /vbaProject\.bin$/i.test(name)))) {
    throw new InputError("Файл не соответствует указанному формату Office", 415);
  }
}

export function validateDocument(buffer: Buffer, name: string) {
  const info = documentName(name);
  if (!buffer.length) throw new InputError("Нельзя отправить пустой файл");
  if (buffer.length > MAX_DOCUMENT_SIZE) throw new InputError("Максимальный размер файла — 2 ГБ", 413);
  if (buffer.length > MAX_INSPECTED_DOCUMENT_SIZE) {
    return { ...info, mimeType: 'application/octet-stream', size: buffer.length };
  }
  switch (info.extension) {
    case "pdf":
      if (!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(buffer.toString("ascii", 0, 8)) ||
          !buffer.subarray(-2048).includes(Buffer.from("%%EOF"))) throw new InputError("Некорректный PDF", 415);
      break;
    case "txt": case "csv": {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
      catch { throw new InputError("Текстовый файл должен быть в UTF-8", 415); }
      if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) throw new InputError("Файл содержит двоичные данные", 415);
      break;
    }
    case "zip": case "docx": case "xlsx": case "pptx": validateZip(buffer, info.extension); break;
    // Неизвестные форматы хранятся как непрозрачные байты, без распаковки/исполнения.
  }
  return { ...info, mimeType: documentMimeType(info.extension), size: buffer.length };
}
