import { validMutationOrigin } from '../../../src/lib/request-origin';
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
  const response = NextResponse.json({
    message: "Выход выполнен",
  });

  response.cookies.set("mediachat_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
