import { validMutationOrigin } from '../../../src/lib/request-origin';
import { InputError, limitedJson } from "../../../src/lib/request-body";
import { authRateLimit } from "../../../src/lib/rate-limit";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { db } from "../../../src/prisma/db";

export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return NextResponse.json({ error: 'Ожидается JSON' }, { status: 415 });
  const retryAfter = authRateLimit(request, "register");
  if (retryAfter) return NextResponse.json(
    { error: "Слишком много попыток. Попробуйте позже." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
  try {
    const body = await limitedJson(request);
    if (!body || typeof body !== "object" || !("username" in body) || !("password" in body) ||
        typeof body.username !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ error: "Введите имя пользователя и пароль" }, { status: 400 });
    }

    const username = body.username.trim();
    const password = body.password;

    // Проверяем имя пользователя
    if (username.length < 3 || username.length > 32 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(username)) {
      return NextResponse.json(
        {
          error:
            "Имя пользователя должно содержать от 3 до 32 символов",
        },
        { status: 400 }
      );
    }

    // bcrypt использует не более 72 байт пароля.
    const passwordBytes = new TextEncoder()
      .encode(password).length;

    if (!password.trim() || password.length < 8 || passwordBytes > 72) {
      return NextResponse.json(
        {
          error:
            "Пароль должен содержать минимум 8 символов и не более 72 байт",
        },
        { status: 400 }
      );
    }

    // Проверяем, занято ли имя пользователя
    const existingUser = await db.orm.public.User
      .where({ username })
      .first();

    if (existingUser) {
      return NextResponse.json(
        { error: "Это имя пользователя уже занято" },
        { status: 409 }
      );
    }

    // Хешируем пароль перед сохранением
    const passwordHash = await bcrypt.hash(password, 12);

    // Создаём пользователя в PostgreSQL
    let user;

    try {
      user = await db.orm.public.User.create({
        username,
        passwordHash,
      });
    } catch (error) {
      // Защита от одновременной регистрации
      // двух пользователей с одним именем
      const duplicate = await db.orm.public.User
        .where({ username })
        .first();

      if (duplicate) {
        return NextResponse.json(
          { error: "Это имя пользователя уже занято" },
          { status: 409 }
        );
      }

      throw error;
    }

    return NextResponse.json(
      {
        message: "Аккаунт успешно создан",
        user: {
          id: user.id,
          username: user.username,
        },
      },
      { status: 201 }
    );

  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ошибка регистрации:", error);

    return NextResponse.json(
      { error: "Не удалось создать аккаунт" },
      { status: 500 }
    );
  }
}
