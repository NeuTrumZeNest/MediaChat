import { conversationId, canAccessConversation } from "../../../src/lib/conversations";
import { summarizeReply } from "../../../src/lib/message-actions";
import { storedImageUrls } from "../../../src/lib/image-albums";
import { getVideoInfo } from "../../../src/lib/video-storage";
import { getDocumentInfo } from "../../../src/lib/document-storage";
import { getAudioOriginalName } from "../../../src/lib/audio-metadata";
import { authorizeImageRequest } from "../../../src/lib/image-storage";
import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../src/prisma/db";

export async function GET(request: NextRequest) {
  const auth = await authorizeImageRequest(request);
  if (!auth.ok) return auth.response;
  try {
    let scope: number | null;
    let before: number | null;
    try { scope = conversationId(request.nextUrl.searchParams.get('conversationId')); before = conversationId(request.nextUrl.searchParams.get('before')); }
    catch { return NextResponse.json({ error: 'Некорректный курсор или переписка' }, { status: 400 }); }
    if (!await canAccessConversation(auth.userId, scope)) return NextResponse.json({ error: 'Переписка недоступна' }, { status: 403 });
    const limit = 50;
    const storedMessages = await db.orm.public.Message
        .where({ conversationId: scope, deletedAt: null })
        .include("images")
        .include("replyTo", (source) => source.include("user", (author) => author.select("id", "username", "avatarUrl")))
        .include("user", (author) => author.select("id", "username", "avatarUrl"))
        .orderBy((m) => m.id.desc()).cursor(before === null ? {} : { id: before }).limit(limit + 1).all();

    const hasMore = storedMessages.length > limit;
    if (hasMore) storedMessages.pop();
    storedMessages.sort((a, b) => a.id - b.id);

    // Only tombstones inside this bounded page are needed. Quotes serialize their
    // source's deleted status separately, including sources outside the page.
    const firstId = storedMessages[0]?.id ?? 2147483647;
    const deleted = await db.orm.public.Message.where((message) => message.deletedAt.isNotNull())
      .where({ conversationId: scope }).where((message) => message.id.gte(firstId))
      .where((message) => message.id.lte(before === null ? 2147483647 : before - 1)).select('id').all();
    const messages = await Promise.all(
      storedMessages.map(async (message) => {
        return {
          id: message.id,
          conversationId: message.conversationId,
          text: message.text,
          editedAt: message.editedAt?.toString() ?? null,
          replyToId: message.replyToId,
          replyTo: summarizeReply(message.replyTo, message.conversationId),
          imageUrl: message.imageUrl,
          imageUrls: storedImageUrls(message.images, message.imageUrl),
          audioUrl: message.audioUrl,
          audioName: await getAudioOriginalName(message.audioUrl),
          documentUrl: message.documentUrl,
          document: await getDocumentInfo(message.documentUrl),
          videoUrl: message.videoUrl,
          video: await getVideoInfo(message.videoUrl),
          userId: message.userId,
          avatarUrl: message.user?.avatarUrl ?? null,
          author: message.user?.username ?? "Неизвестный пользователь",
          createdAt: message.createdAt.toString(),
        };
      })
    );

    return NextResponse.json({
      messages, hasMore, nextCursor: hasMore ? messages[0]?.id ?? null : null,
      deletedMessageIds: deleted.map((message) => message.id),
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
