import { NextResponse } from "next/server";

export async function POST() {
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
