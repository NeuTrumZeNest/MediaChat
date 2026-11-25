
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  authorizeImageRequest,
  cachedImageResponse,
  canReadImage,
  getImageMetadata,
  isMissingFile,
  parsePreviewFilename,
  PREVIEW_DIR,
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
  const id = parsePreviewFilename(filename);

  if (!id) {
    return NextResponse.json(
      { error: "Неверное имя файла" },
      { status: 400 }
    );
  }

  try {
    const metadata = await getImageMetadata(id);

    if (!metadata?.previewAvailable) {
      return NextResponse.json(
        { error: "Превью отсутствует" },
        { status: 404 }
      );
    }

    const originalFilename =
      `${id}.${metadata.extension}`;

    if (
      !(await canReadImage(
        originalFilename,
        auth.userId
      ))
    ) {
      return NextResponse.json(
        { error: "Изображение недоступно" },
        { status: 404 }
      );
    }

    
    return await cachedImageResponse(
    request,
    join(PREVIEW_DIR, `${id}.webp`),
    "image/webp"
    );

  } catch (error) {
    if (isMissingFile(error)) {
      return NextResponse.json(
        { error: "Превью не найдено" },
        { status: 404 }
      );
    }

    console.error(
      "Ошибка чтения превью:",
      error
    );

    return NextResponse.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
