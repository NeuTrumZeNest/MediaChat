import { validMutationOrigin } from "./request-origin.ts";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../prisma/db.ts';
import { authorizeImageRequest } from './image-storage.ts';
import { limitedFormData } from './request-body.ts';
import { prepareAvatar, writeAvatar, cleanupAvatar, publishProfile } from './avatar-storage.ts';
import { lockResources } from './media-locks.ts';
import { publishConversation } from './conversations.ts';
import { conversationResource } from './groups.ts';
import { consumeLimit } from './rate-limit.ts';
export async function avatarChange(request: NextRequest, groupId: number | null) {
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 });
  const auth = await authorizeImageRequest(request); if (!auth.ok) return auth.response;
  if (consumeLimit(`avatar:${auth.userId}`, 20, 60000)) return NextResponse.json({ error: 'Подождите минуту' }, { status: 429 });
  let fresh: string | null = null;
  try {
    if (request.method !== 'DELETE') {
      const form = await limitedFormData(request, 10 * 1024 * 1024);
      const file = form.get('avatar'); if (!(file instanceof File)) throw new Error('Выберите изображение');
      const bytes = await prepareAvatar(new Uint8Array(await file.arrayBuffer()), file.type, JSON.parse(String(form.get('crop'))));
      fresh = await writeAvatar(bytes);
    }
    const result = await db.transaction(async (tx) => {
      await lockResources(tx, [groupId === null ? `profile:${auth.userId}` : conversationResource(groupId)]);
      if (groupId === null) {
        const user = await tx.orm.public.User.where({ id: auth.userId }).first(); if (!user) throw new Error('Пользователь недоступен');
        await tx.orm.public.User.where({ id: auth.userId }).update({ avatarUrl: fresh });
        return { old: user.avatarUrl, user: { id: user.id, username: user.username, avatarUrl: fresh }, members: [] as number[] };
      }
      const group = await tx.orm.public.Conversation.where({ id: groupId, kind: 'group', deletedAt: null }).include('members').first();
      const role = group?.members.find((m) => m.userId === auth.userId)?.role;
      if (!group || !role || role === 'member') throw new Error('Недостаточно прав');
      await tx.orm.public.Conversation.where({ id: groupId }).update({ avatarUrl: fresh });
      return { old: group.avatarUrl, user: null, members: group.members.map((m) => m.userId) };
    });
    if (result.user) publishProfile(result.user); else await publishConversation(result.members, groupId!);
    try { await cleanupAvatar(result.old); } catch (error) { console.error('Старая аватарка будет очищена позже:', error); }
    return NextResponse.json({ avatarUrl: fresh });
  } catch (error) {
    if (fresh) await cleanupAvatar(fresh).catch(() => {});
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
