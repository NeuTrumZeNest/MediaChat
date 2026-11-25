import { canReadAttachment } from "../../../../src/lib/attachment-access";
import { documentStorageExtension } from "../../../../src/lib/document-types";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { authorizeImageRequest } from "../../../../src/lib/image-storage";
import { DOCUMENT_DIR, readDocument } from "../../../../src/lib/document-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  const { filename } = await params;
  try {
    const document = await readDocument(filename);
    if (!document) return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
    const allowed = await canReadAttachment(`/api/documents/${filename}`, document.ownerId, auth.userId);
    if (!allowed) return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
    const encoded = encodeURIComponent(document.originalName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const stream = createReadStream(join(DOCUMENT_DIR, filename));
    const abort = () => stream.destroy();
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => request.signal.removeEventListener("abort", abort));
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(document.size),
      "Content-Disposition": `attachment; filename="document.${documentStorageExtension(document.extension)}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    } });
  } catch (error) {
    console.error("Ошибка скачивания документа:", error);
    return NextResponse.json({ error: "Не удалось скачать документ" }, { status: 500 });
  }
}
