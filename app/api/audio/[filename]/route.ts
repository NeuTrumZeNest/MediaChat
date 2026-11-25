import { canReadAttachment } from "../../../../src/lib/attachment-access";

import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  authorizeImageRequest,
} from "../../../../src/lib/image-storage";

export const runtime = "nodejs";

const AUDIO_NAME =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp3|wav|flac)$/;

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ filename: string }>;
  }
) {
  const auth = await authorizeImageRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { filename } = await params;
  const match = AUDIO_NAME.exec(filename);

  if (!match) {
    return NextResponse.json(
      { error: "Некорректное имя аудиофайла" },
      { status: 400 }
    );
  }

  const id = match[1];
  const extension = match[2];

  const audioDirectory = join(
    process.cwd(),
    "uploads",
    "audio"
  );

  const filePath = join(audioDirectory, filename);

  const metadataPath = join(
    audioDirectory,
    "metadata",
    `${id}.json`
  );

  try {
    const raw = await readFile(metadataPath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json(
        { error: "Файл недоступен" },
        { status: 404 }
      );
    }

    const metadata = parsed as {
      filename?: unknown;
      ownerId?: unknown;
    };

    if (
      metadata.filename !== filename ||
      typeof metadata.ownerId !== "number" ||
      !Number.isSafeInteger(metadata.ownerId)
    ) {
      return NextResponse.json(
        { error: "Файл недоступен" },
        { status: 404 }
      );
    }

    const allowed = await canReadAttachment(`/api/audio/${filename}`, metadata.ownerId, auth.userId);

    if (!allowed) {
      return NextResponse.json(
        { error: "Нет доступа к аудиофайлу" },
        { status: 404 }
      );
    }

    const fileInfo = await stat(filePath);

    if (
      !fileInfo.isFile() ||
      fileInfo.size === 0 ||
      fileInfo.size > MAX_AUDIO_SIZE
    ) {
      return NextResponse.json(
        { error: "Файл недоступен" },
        { status: 404 }
      );
    }

    const size = fileInfo.size;
    const range = request.headers.get("range");

    let start = 0;
    let end = size - 1;
    let status = 200;

    const headers = new Headers({
      "Content-Type": MIME_TYPES[extension],
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });

    if (range) {
      const parts = /^bytes=(\d*)-(\d*)$/.exec(range);

      let valid = Boolean(
        parts && (parts[1] || parts[2])
      );

      if (parts && valid) {
        if (parts[1] === "") {
          const suffix = Number(parts[2]);

          valid =
            Number.isSafeInteger(suffix) &&
            suffix > 0;

          if (valid) {
            start = Math.max(0, size - suffix);
          }
        } else {
          start = Number(parts[1]);

          if (parts[2]) {
            end = Math.min(
              Number(parts[2]),
              size - 1
            );
          }

          valid =
            Number.isSafeInteger(start) &&
            Number.isSafeInteger(end) &&
            start >= 0 &&
            start < size &&
            start <= end;
        }
      }

      if (!valid) {
        headers.set(
          "Content-Range",
          `bytes */${size}`
        );

        return new Response(null, {
          status: 416,
          headers,
        });
      }

      status = 206;

      headers.set(
        "Content-Range",
        `bytes ${start}-${end}/${size}`
      );
    }

    headers.set(
      "Content-Length",
      String(end - start + 1)
    );

    const stream = createReadStream(filePath, {
      start,
      end,
    });

    const webStream = Readable.toWeb(
      stream
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status,
      headers,
    });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return NextResponse.json(
        { error: "Аудиофайл не найден" },
        { status: 404 }
      );
    }

    console.error("Ошибка выдачи аудио:", error);

    return NextResponse.json(
      { error: "Не удалось получить аудиофайл" },
      { status: 500 }
    );
  }
}
