import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "../../../src/prisma/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

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

    return NextResponse.json(
      {
        message: "Вход выполнен",
        user: {
          id: user.id,
          username: user.username,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Ошибка входа:", error);

    return NextResponse.json(
      { error: "Не удалось выполнить вход" },
      { status: 500 }
    );
  }
}