import { InputError } from "./request-body.ts";
import { mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateDocument, documentName } from "./document-format.ts";
import { documentMimeType, documentStorageExtension, MAX_DOCUMENT_SIZE, type DocumentInfo } from "./document-types.ts";

export const DOCUMENT_DIR = join(process.cwd(), "uploads", "documents");
export const DOCUMENT_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|txt|csv|docx|xlsx|pptx|zip|bin)$/;
type StoredDocument = Omit<DocumentInfo, "url"> & { id: string; filename: string; ownerId: number; uploadedAt: string };

export async function readDocument(filename: string): Promise<StoredDocument | null> {
  const match = DOCUMENT_PATTERN.exec(filename);
  if (!match) return null;
  try {
    const data = JSON.parse(await readFile(join(DOCUMENT_DIR, "metadata", `${match[1]}.json`), "utf8"));
    if (!data || data.id !== match[1] || data.filename !== filename || typeof data.extension !== "string" || (data.opaque === true ? "bin" : documentStorageExtension(data.extension)) !== match[2] ||
        typeof data.originalName !== "string" || !Number.isSafeInteger(data.ownerId) || data.ownerId <= 0 ||
        !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > MAX_DOCUMENT_SIZE ||
        data.mimeType !== (data.opaque === true ? "application/octet-stream" : documentMimeType(data.extension, data.size))) return null;
    if (documentName(data.originalName).extension !== data.extension) return null;
    const file = await stat(join(DOCUMENT_DIR, filename));
    if (!file.isFile() || file.size !== data.size) return null;
    return data as StoredDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError || error instanceof InputError) return null;
    throw error;
  }
}

export async function getDocumentInfo(url: string | null): Promise<DocumentInfo | null> {
  if (!url?.startsWith("/api/documents/")) return null;
  const data = await readDocument(url.slice("/api/documents/".length));
  return data ? { url, originalName: data.originalName, extension: data.extension, mimeType: data.mimeType, size: data.size } : null;
}

export async function assertOwnedDocument(url: string, userId: number) {
  if (!url.startsWith("/api/documents/")) throw new Error("Некорректный адрес документа");
  const data = await readDocument(url.slice("/api/documents/".length));
  if (!data || data.ownerId !== userId) throw new Error("Документ не принадлежит вам");
}

export async function saveDocument(buffer: Buffer, originalName: string, ownerId: number) {
  const validated = validateDocument(buffer, originalName);
  const id = randomUUID();
  const filename = `${id}.${documentStorageExtension(validated.extension)}`;
  const filePath = join(DOCUMENT_DIR, filename);
  const metadataPath = join(DOCUMENT_DIR, "metadata", `${id}.json`);
  const metadata: StoredDocument = { ...validated, id, filename, ownerId, uploadedAt: new Date().toISOString() };
  await mkdir(join(DOCUMENT_DIR, "metadata"), { recursive: true });
  let written = false;
  try {
    await writeFile(filePath, buffer, { flag: "wx" });
    written = true;
    await writeFile(metadataPath, JSON.stringify(metadata), { flag: "wx" });
  } catch (error) {
    if (written) await rm(filePath, { force: true });
    throw error;
  }
  return { url: `/api/documents/${filename}`, ...validated };
}
