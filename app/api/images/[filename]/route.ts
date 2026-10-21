import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../../../src/prisma/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ filename: string }>;
  }
) {
  // Проверяем авторизацию
  const token = request.cookies.get(
    "mediachat_session"
  )?.value;

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

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );

    const userId = Number(payload.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Недействительная сессия");
    }

    const user = await db.orm.public.User
      .where({ id: userId })
      .first();

    if (!user) {
      throw new Error("Пользователь не найден");
    }
  } catch {
    return NextResponse.json(
      { error: "Недействительная сессия" },
      { status: 401 }
    );
  }

  // Получаем название изображения
  const { filename } = await context.params;

  // Разрешаем только имена нашего формата
  const filenamePattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

  if (!filenamePattern.test(filename)) {
    return NextResponse.json(
      { error: "Недопустимое имя файла" },
      { status: 400 }
    );
  }

  const extension = filename.split(".").pop()!;
  const contentType = imageTypes[extension];

  const filePath = join(
    process.cwd(),
    "uploads",
    filename
  );

  // Читаем изображение с диска
  try {
    const image = await readFile(filePath);

    return new NextResponse(
      new Uint8Array(image),
      {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return NextResponse.json(
        { error: "Изображение не найдено" },
        { status: 404 }
      );
    }

    console.error(
      "Ошибка чтения изображения:",
      error
    );

    return NextResponse.json(
      { error: "Не удалось открыть изображение" },
      { status: 500 }
    );
  }
}
