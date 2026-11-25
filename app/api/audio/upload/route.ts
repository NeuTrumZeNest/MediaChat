import { validMutationOrigin } from "../../../../src/lib/request-origin";
import { InputError, limitedFormData } from "../../../../src/lib/request-body";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  authorizeImageRequest,
} from "../../../../src/lib/image-storage";

export const runtime = "nodejs";

const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

type AudioExtension = "mp3" | "wav" | "flac";

function detectAudioType(
  buffer: Buffer
): AudioExtension | null {
  // FLAC
  if (
    buffer.length >= 4 &&
    buffer.toString("ascii", 0, 4) === "fLaC"
  ) {
    return "flac";
  }

  // WAV
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    return "wav";
  }

  // MP3 с заголовком ID3
  if (
    buffer.length >= 3 &&
    buffer.toString("ascii", 0, 3) === "ID3"
  ) {
    return "mp3";
  }

  // MP3 без ID3, начинающийся с MPEG-фрейма
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0 &&
    (buffer[1] & 0x18) !== 0x08 &&
    (buffer[1] & 0x06) !== 0
  ) {
    return "mp3";
  }

  return null;
}

function getAudioMimeType(
  extension: AudioExtension
): string {
  switch (extension) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
  }
}

function safeAudioName(
  name: string,
  extension: AudioExtension
): string {
  return (
    name
      .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
      .trim()
      .slice(0, 180) || `audio.${extension}`
  );
}

export async function POST(request: NextRequest) {
  const auth = await authorizeImageRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  // Проверяем источник запроса.
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });

  const contentLength = Number(
    request.headers.get("content-length") ?? "0"
  );

  if (
    contentLength > MAX_AUDIO_SIZE + 1024 * 1024
  ) {
    return NextResponse.json(
      { error: "Слишком большой запрос" },
      { status: 413 }
    );
  }

  let buffer: Buffer;
  let extension: AudioExtension;
  let originalName: string;

  try {
    const formData = await limitedFormData(request, MAX_AUDIO_SIZE);
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Аудиофайл не выбран" },
        { status: 400 }
      );
    }

    if (
      audio.size === 0 ||
      audio.size > MAX_AUDIO_SIZE
    ) {
      return NextResponse.json(
        { error: "Максимальный размер - 50 МБ" },
        { status: 413 }
      );
    }

    buffer = Buffer.from(await audio.arrayBuffer());

    const detected = detectAudioType(buffer);

    if (!detected) {
      return NextResponse.json(
        { error: "Поддерживаются MP3, WAV и FLAC" },
        { status: 415 }
      );
    }

    extension = detected;
    originalName = safeAudioName(
      audio.name,
      extension
    );
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ошибка обработки аудио:", error);

    return NextResponse.json(
      { error: "Не удалось прочитать аудиофайл" },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const filename = `${id}.${extension}`;

  const audioDirectory = join(
    process.cwd(),
    "uploads",
    "audio"
  );

  const metadataDirectory = join(
    audioDirectory,
    "metadata"
  );

  const filePath = join(audioDirectory, filename);
  const metadataPath = join(
    metadataDirectory,
    `${id}.json`
  );

  const metadata = {
    id,
    filename,
    originalName,
    extension,
    mimeType: getAudioMimeType(extension),
    size: buffer.length,
    ownerId: auth.userId,
    uploadedAt: new Date().toISOString(),
  };

  let fileWritten = false;

  try {
    await mkdir(metadataDirectory, {
      recursive: true,
    });

    await writeFile(filePath, buffer, {
      flag: "wx",
    });

    fileWritten = true;

    await writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      { flag: "wx" }
    );

    return NextResponse.json(
      {
        audioUrl: `/api/audio/${filename}`,
        originalName,
        size: buffer.length,
        mimeType: metadata.mimeType,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ошибка сохранения аудио:", error);

    if (fileWritten) {
      await rm(filePath, {
        force: true,
      }).catch(() => undefined);
    }

    return NextResponse.json(
      { error: "Не удалось сохранить аудиофайл" },
      { status: 500 }
    );
  }
}
