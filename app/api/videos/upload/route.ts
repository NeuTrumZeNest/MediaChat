import { validMutationOrigin } from "../../../../src/lib/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { authorizeImageRequest } from "../../../../src/lib/image-storage";
import { consumeLimit } from "../../../../src/lib/rate-limit";
import { InputError } from "../../../../src/lib/request-body";
import { saveVideo } from "../../../../src/lib/video-storage";

export const runtime = "nodejs";
const active = new Set<number>();

export async function POST(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });

  const retryAfter = consumeLimit(`video-upload:${auth.userId}`, 10, 10 * 60_000);
  // Не более одной обработки на пользователя и двух FFmpeg-задач на процесс.
  if (retryAfter || active.has(auth.userId) || active.size >= 2) return NextResponse.json(
    { error: "Сервер обрабатывает видео. Подождите и повторите загрузку." },
    { status: 429, headers: { "Retry-After": String(retryAfter || 5) } }
  );
  active.add(auth.userId);
  try {
    const name = request.nextUrl.searchParams.get("name") || "";
    const video = await saveVideo(request, name, auth.userId);
    return NextResponse.json({ videoUrl: video.url, video }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Ошибка загрузки видео:", error);
    return NextResponse.json({ error: "Не удалось сохранить видео" }, { status: 500 });
  } finally { active.delete(auth.userId); }
}
