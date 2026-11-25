import { canReadAttachment } from "./attachment-access.ts";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, constants, openSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { authorizeImageRequest } from "./image-storage";
import { VIDEO_DIR, readVideo } from "./video-storage";
import { parseRange } from "./http-range";

async function authorizedVideo(request: NextRequest, filename: string) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth;
  const video = await readVideo(filename);
  if (!video) return { ok: false as const, response: NextResponse.json({ error: "Видео недоступно" }, { status: 404 }) };
  const allowed = await canReadAttachment(video.url, video.ownerId, auth.userId);
  return allowed ? { ok: true as const, video } : { ok: false as const, response: NextResponse.json({ error: "Видео недоступно" }, { status: 404 }) };
}

function fileStream(path: string, request: Request, start: number, end: number) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stream = createReadStream(path, { start, end, fd, autoClose: true });
  const abort = () => stream.destroy();
  request.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => request.signal.removeEventListener("abort", abort));
  if (request.signal.aborted) stream.destroy();
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function videoResponse(request: NextRequest, filename: string, poster = false, head = false) {
  try {
    const auth = await authorizedVideo(request, filename);
    if (!auth.ok) return auth.response;
    const { video } = auth;
    if (poster) {
      const path = join(VIDEO_DIR, "posters", `${video.id}.jpg`);
      const info = await lstat(path);
      if (!info.isFile() || !info.size) return NextResponse.json({ error: "Превью недоступно" }, { status: 404 });
      return new Response(head ? null : fileStream(path, request, 0, info.size - 1), { headers: {
        "Content-Type": "image/jpeg", "Content-Length": String(info.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    const headers = new Headers({
      "Content-Type": video.mimeType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    });
    const range = parseRange(head ? null : request.headers.get("range"), video.size);
    if (!range) {
      headers.set("Content-Range", `bytes */${video.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (range.status === 206) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${video.size}`);
    if (request.nextUrl.searchParams.get("download") === "1") {
      const name = encodeURIComponent(video.originalName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      headers.set("Content-Disposition", `attachment; filename="video.${video.extension}"; filename*=UTF-8''${name}`);
    }
    return new Response(head ? null : fileStream(join(VIDEO_DIR, filename), request, range.start, range.end), { status: range.status, headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Видео недоступно" }, { status: 404 });
    console.error("Ошибка выдачи видео:", error);
    return NextResponse.json({ error: "Не удалось получить видео" }, { status: 500 });
  }
}
