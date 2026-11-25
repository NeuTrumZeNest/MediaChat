import { validMutationOrigin } from '../../../src/lib/request-origin';
import { InputError, limitedJson } from "../../../src/lib/request-body";
import { authRateLimit } from "../../../src/lib/rate-limit";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { db } from "../../../src/prisma/db";

export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return NextResponse.json({ error: 'Ожидается JSON' }, { status: 415 });
  const retryAfter = authRateLimit(request, "login");
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
    if (username.length > 32 || new TextEncoder().encode(password).length > 72) {
      return NextResponse.json({ error: "Некорректная длина имени или пароля" }, { status: 400 });
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: "Введите имя пользователя и пароль" },
        { status: 400 }
      );
    }

    const user = await db.orm.public.User
      .where({ username })
      .first();

    if (!user) {
      return NextResponse.json(
        { error: "Неверное имя пользователя или пароль" },
        { status: 401 }
      );
    }

    const passwordIsCorrect = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordIsCorrect) {
      return NextResponse.json(
        { error: "Неверное имя пользователя или пароль" },
        { status: 401 }
      );
    }

    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("SESSION_SECRET не задан");
    }

    const token = await new SignJWT({
      userId: user.id,
      username: user.username,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(secret));

    const response = NextResponse.json(
      {
        message: "Вход выполнен",
        user: {
          id: user.id,
          username: user.username,
        },
      },
      { status: 200 }
    );

    response.cookies.set("mediachat_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ошибка входа:", error);

    return NextResponse.json(
      { error: "Не удалось выполнить вход" },
      { status: 500 }
    );
  }
}