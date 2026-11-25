import { validMutationOrigin } from "../../../../src/lib/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { authorizeImageRequest } from "../../../../src/lib/image-storage";
import { InputError, limitedFormData } from "../../../../src/lib/request-body";
import { MAX_INSPECTED_DOCUMENT_SIZE } from "../../../../src/lib/document-types";
import { saveStreamedDocument } from "../../../../src/lib/document-stream";
import { saveDocument } from "../../../../src/lib/document-storage";
import { consumeLimit } from "../../../../src/lib/rate-limit";

export const runtime = "nodejs";
const active = new Set<number>();

export async function POST(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });

  const retryAfter = consumeLimit(`document-upload:${auth.userId}`, 20, 10 * 60_000);
  if (retryAfter || active.has(auth.userId) || active.size >= 2) return NextResponse.json(
    { error: "Слишком много загрузок. Дождитесь окончания и попробуйте позже." },
    { status: 429, headers: { "Retry-After": String(retryAfter || 2) } }
  );
  active.add(auth.userId);
  try {
    const name = request.nextUrl.searchParams.get("name");
    let document;
    if (name !== null) {
      document = await saveStreamedDocument(request, name, auth.userId, request.nextUrl.searchParams.get("asFile") === "1");
    } else {
      // Старые клиенты: multipart ограничен прежними 25 МиБ, чтобы не буферизовать гигабайты.
      const form = await limitedFormData(request, MAX_INSPECTED_DOCUMENT_SIZE);
      const file = form.get("document");
      if (!(file instanceof File)) throw new InputError("Выберите документ");
      if (!file.size) throw new InputError("Нельзя отправить пустой файл");
      if (file.size > MAX_INSPECTED_DOCUMENT_SIZE) throw new InputError("Обновите страницу для отправки файлов больше 25 МБ", 413);
      document = await saveDocument(Buffer.from(await file.arrayBuffer()), file.name, auth.userId);
    }
    return NextResponse.json({ documentUrl: document.url, document }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") return NextResponse.json({ error: "На сервере недостаточно свободного места" }, { status: 507 });
    if (error instanceof TypeError) return NextResponse.json({ error: "Не удалось прочитать файл" }, { status: 400 });
    console.error("Ошибка загрузки документа:", error);
    return NextResponse.json({ error: "Не удалось сохранить документ" }, { status: 500 });
  } finally { active.delete(auth.userId); }
}
