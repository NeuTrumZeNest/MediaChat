import { NextRequest, NextResponse } from "next/server";
import { authorizeImageRequest } from "../../../src/lib/image-storage";
import { db } from "../../../src/prisma/db";

export async function GET(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const query = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 64);
    const storedUsers = await db.orm.public.User.where((u) => u.id.neq(auth.userId))
      .where((u) => u.username.ilike(`%${query.replace(/[\\%_]/g, "\\$&")}%`))
      .select("id", "username", "avatarUrl").orderBy((u) => u.username.asc()).limit(30).all();

    const users = storedUsers.map((user) => ({
      id: user.id,
      username: user.username,
          avatarUrl: user.avatarUrl,
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Ошибка загрузки пользователей:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить пользователей" },
      { status: 500 }
    );
  }
}
