import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "../../../src/prisma/db";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("mediachat_session")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Необходимо войти в аккаунт" },
        { status: 401 }
      );
    }

    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("SESSION_SECRET не задан");
    }

    await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );

    const storedMessages =
      await db.orm.public.Message.all();

    storedMessages.sort((a, b) => a.id - b.id);

    const messages = await Promise.all(
      storedMessages.map(async (message) => {
        const author = await db.orm.public.User
          .where({ id: message.userId })
          .first();

        return {
          id: message.id,
          text: message.text,
          imageUrl: message.imageUrl,
          userId: message.userId,
          author: author?.username ?? "Неизвестный пользователь",
          createdAt: message.createdAt.toString(),
        };
      })
    );

    return NextResponse.json({
      messages,
    });
  } catch (error) {
    console.error(
      "Ошибка загрузки сообщений:",
      error
    );

    return NextResponse.json(
      { error: "Не удалось загрузить сообщения" },
      { status: 500 }
    );
  }
}
