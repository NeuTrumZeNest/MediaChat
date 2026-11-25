import { or } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { canAccessConversation } from './conversations.ts';
export async function canReadAttachment(url: string, ownerId: number | undefined, userId: number) {
  const [messages, albums] = await Promise.all([
    db.orm.public.Message.where({ deletedAt: null }).where((m) => or(m.imageUrl.eq(url), m.audioUrl.eq(url), m.videoUrl.eq(url), m.documentUrl.eq(url))).select('conversationId').all(),
    db.orm.public.MessageImage.where({ imageUrl: url }).include('message').all(),
  ]);
  const refs = [...messages, ...albums.filter((m) => !m.message.deletedAt).map((m) => m.message)];
  if (!refs.length) return ownerId === userId;
  for (const ref of refs) if (await canAccessConversation(userId, ref.conversationId)) return true;
  return false;
}
