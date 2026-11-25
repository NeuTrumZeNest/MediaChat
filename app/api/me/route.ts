import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "../../../src/prisma/db";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("mediachat_session")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Вы не вошли в аккаунт" },
        { status: 401 }
      );
    }

    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("SESSION_SECRET не задан");
    }

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] }
    );

    const userId = Number(payload.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        { error: "Недействительная сессия" },
        { status: 401 }
      );
    }

    const user = await db.orm.public.User
      .where({ id: userId })
      .first();

    if (!user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Ошибка проверки сессии:", error);

    const response = NextResponse.json(
      { error: "Недействительная или истёкшая сессия" },
      { status: 401 }
    );

    response.cookies.delete("mediachat_session");

    return response;
  }
}
