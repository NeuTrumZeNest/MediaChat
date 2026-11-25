import { validMutationOrigin } from "../../../src/lib/request-origin";
import { MAX_IMAGE_SIZE } from "../../../src/lib/image-types";
import { InputError, limitedFormData } from "../../../src/lib/request-body";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  authorizeImageRequest,
  imageMimeType,
  META_DIR,
  PREVIEW_DIR,
  safeOriginalName,
  UPLOAD_DIR,
  type ImageExtension,
  type ImageMetadata,
} from "../../../src/lib/image-storage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = MAX_IMAGE_SIZE;
const MAX_PIXELS = 40_000_000;

function detectImageType(
  buffer: Buffer
): ImageExtension | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return "png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  ) {
    return "jpg";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  const signature = buffer.toString("ascii", 0, 6);

  if (
    signature === "GIF87a" ||
    signature === "GIF89a"
  ) {
    return "gif";
  }

  return null;
}

async function generatePreview(
  buffer: Buffer,
  ext: ImageExtension
): Promise<Buffer | null> {
  const input = {
    limitInputPixels: MAX_PIXELS,
  };

  const metadata = await sharp(
    buffer,
    input
  ).metadata();

  const actual =
    metadata.format === "jpeg"
      ? "jpg"
      : metadata.format;

  if (
    actual !== ext ||
    !metadata.width ||
    !metadata.height
  ) {
    throw new Error("Неверный формат изображения");
  }

  if (
    metadata.width * metadata.height > MAX_PIXELS
  ) {
    throw new Error("Изображение слишком большое");
  }

  // Сохраняем анимацию GIF, WebP и APNG.
  if (
    ext === "gif" ||
    (metadata.pages ?? 1) > 1
  ) {
    return null;
  }

  const pipeline = sharp(buffer, input)
    .rotate()
    .resize({
      width: 960,
      height: 960,
      fit: "inside",
      withoutEnlargement: true,
    });

  const preview =
    ext === "png"
      ? await pipeline
          .webp({
            lossless: true,
            effort: 4,
          })
          .toBuffer()
      : await pipeline
          .webp({
            quality: 82,
            effort: 4,
          })
          .toBuffer();

  return preview.length < buffer.length
    ? preview
    : null;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeImageRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });

  const contentLength = Number(
    request.headers.get("content-length") ?? "0"
  );

  if (
    contentLength > MAX_FILE_SIZE + 1024 * 1024
  ) {
    return NextResponse.json(
      { error: "Слишком большой запрос" },
      { status: 413 }
    );
  }

  let buffer: Buffer;
  let extension: ImageExtension;
  let originalName: string;
  let preview: Buffer | null;

  try {
    const data = await limitedFormData(request, MAX_FILE_SIZE);
    const image = data.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Изображение не выбрано" },
        { status: 400 }
      );
    }

    if (
      image.size === 0 ||
      image.size > MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          error: "Размер изображения должен быть до 25 МБ",
        },
        { status: 413 }
      );
    }

    buffer = Buffer.from(
      await image.arrayBuffer()
    );

    const detected = detectImageType(buffer);

    if (!detected) {
      return NextResponse.json(
        {
          error: "Поддерживаются PNG, JPG, WebP и GIF",
        },
        { status: 415 }
      );
    }

    extension = detected;

    originalName = safeOriginalName(
      image.name,
      extension
    );

    preview = await generatePreview(
      buffer,
      extension
    );
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(
      "Не удалось прочитать/обработать изображение:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Повреждённое или неподдерживаемое изображение",
      },
      { status: 415 }
    );
  }

  const id = randomUUID();
  const filename = `${id}.${extension}`;

  const originalPath = join(
    UPLOAD_DIR,
    filename
  );

  const metadataPath = join(
    META_DIR,
    `${id}.json`
  );

  const previewPath = join(
    PREVIEW_DIR,
    `${id}.webp`
  );

  const written: string[] = [];

  const metadata: ImageMetadata = {
    id,
    ownerId: auth.userId,
    originalName,
    extension,
    mimeType: imageMimeType(extension),
    size: buffer.length,
    previewAvailable: preview !== null,
    UploadedAt: new Date().toISOString(),
  };

  try {
    await Promise.all([
      mkdir(UPLOAD_DIR, {
        recursive: true,
      }),
      mkdir(META_DIR, {
        recursive: true,
      }),
      mkdir(PREVIEW_DIR, {
        recursive: true,
      }),
    ]);

    await writeFile(
      originalPath,
      buffer,
      { flag: "wx" }
    );

    written.push(originalPath);

    await writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      { flag: "wx" }
    );

    written.push(metadataPath);

    if (preview) {
      await writeFile(
        previewPath,
        preview,
        { flag: "wx" }
      );

      written.push(previewPath);
    }

    console.log(
      "MediaChat upload:",
      buffer.length,
      "байт -> превью",
      preview?.length ?? "не требуется"
    );

    return NextResponse.json(
      {
        imageUrl: `/api/images/${filename}`,
        previewUrl: preview
          ? `/api/images/previews/${id}.webp`
          : `/api/images/${filename}`,
        originalName,
        originalSize: buffer.length,
        previewSize: preview?.length ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(
      "Ошибка сохранения изображения:",
      error
    );

    await Promise.all(
      written.map((path) =>
        rm(path, { force: true }).catch(
          () => undefined
        )
      )
    );

    return NextResponse.json(
      {
        error: "Не удалось сохранить изображение",
      },
      { status: 500 }
    );
  }
}
