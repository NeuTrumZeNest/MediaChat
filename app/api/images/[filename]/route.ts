
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  authorizeImageRequest,
  cachedImageResponse,
  canReadImage,
  imageMimeType,
  isMissingFile,
  parseImageFilename,
  UPLOAD_DIR,
} from "../../../../src/lib/image-storage";

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
        { error: "Изображение недоступно" },
        { status: 404 }
      );
    }

    return await cachedImageResponse(
      request,
      join(UPLOAD_DIR, filename),
      imageMimeType(parsed.extension)
    );
  } catch (error) {
    if (isMissingFile(error)) {
      return NextResponse.json(
        { error: "Файл не найден" },
        { status: 404 }
      );
    }

    console.error(
      "Ошибка чтения изображения:",
      error
    );

    return NextResponse.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
