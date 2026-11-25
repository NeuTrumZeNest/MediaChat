
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  authorizeImageRequest,
  binaryResponse,
  canReadImage,
  getImageMetadata,
  imageMimeType,
  isMissingFile,
  parseImageFilename,
  safeOriginalName,
  UPLOAD_DIR,
} from "../../../../../src/lib/image-storage";

export const runtime = "nodejs";

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
  const parsed = parseImageFilename(filename);

  if (!parsed) {
    return NextResponse.json(
      { error: "Неверное имя файла" },
      { status: 400 }
    );
  }

  try {
    if (!(await canReadImage(filename, auth.userId))) {
      return NextResponse.json(
        { error: "Файл недоступен" },
        { status: 404 }
      );
    }

    const [bytes, metadata] = await Promise.all([
      readFile(join(UPLOAD_DIR, filename)),
      getImageMetadata(parsed.id),
    ]);

    const originalName = safeOriginalName(
      metadata?.originalName ?? filename,
      parsed.extension
    );

    const fallbackName =
      `image.${parsed.extension}`;

    const disposition =
      `attachment; filename="${fallbackName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(originalName)}`;

    return binaryResponse(
      bytes,
      imageMimeType(parsed.extension),
      {
        "Content-Disposition": disposition,
      }
    );
  } catch (error) {
    if (isMissingFile(error)) {
      return NextResponse.json(
        { error: "Файл не найден" },
        { status: 404 }
      );
    }

    console.error(
      "Ошибка скачивания изображения:",
      error
    );

    return NextResponse.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
