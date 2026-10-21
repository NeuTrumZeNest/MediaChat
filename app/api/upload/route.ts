import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../../src/prisma/db";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function detectImageType(buffer: Buffer): string | null {
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

  if (signature === "GIF87a" || signature === "GIF89a") {
    return "gif";
  }

  return null;
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("mediachat_session")?.value;
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "Ошибка конфигурации сервера" },
      { status: 500 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Необходимо войти в аккаунт" },
      { status: 401 }
    );
  }

  let userId: number;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );

    userId = Number(payload.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Недействительная сессия");
    }
  } catch {
    return NextResponse.json(
      { error: "Недействительная сессия" },
      { status: 401 }
    );
  }

  const origin = request.headers.get("origin");
const host = request.headers.get("host");

if (origin && (!host || new URL(origin).host !== host)) {
  return NextResponse.json(
    { error: "Недопустимый источник запроса" },
    { status: 403 }
  );
}

  const contentLength = Number(
    request.headers.get("content-length") ?? "0"
  );

  if (contentLength > MAX_FILE_SIZE + 1024 * 1024) {
    return NextResponse.json(
      { error: "Слишком большой запрос" },
      { status: 413 }
    );
  }

  try {
    const user = await db.orm.public.User
      .where({ id: userId })
      .first();

    if (!user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Изображение не выбрано" },
        { status: 400 }
      );
    }

    if (image.size === 0 || image.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Размер изображения должен быть до 10 МБ" },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const extension = detectImageType(buffer);

    if (!extension) {
      return NextResponse.json(
        { error: "Поддерживаются PNG, JPG, WebP и GIF" },
        { status: 415 }
      );
    }

    const uploadDirectory = join(process.cwd(), "uploads");

    await mkdir(uploadDirectory, { recursive: true });

    const filename = `${randomUUID()}.${extension}`;

    await writeFile(
      join(uploadDirectory, filename),
      buffer,
      { flag: "wx" }
    );

    return NextResponse.json(
      { imageUrl: `/api/images/${filename}` },
      { status: 201 }
    );
  } catch (error) {
    console.error("Ошибка загрузки изображения:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить изображение" },
      { status: 500 }
    );
  }
}
