import { or } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { lockResources, type MediaTransaction } from './media-locks.ts';
import { messagePreview, sameConversation } from './message-actions.ts';

export function conversationId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new Error('Некорректный идентификатор переписки');
  return id;
}
export async function canAccessConversation(userId: number, id: number | null, client: MediaTransaction | typeof db = db) {
  if (id === null) return true;
  const member = await client.orm.public.ConversationMember.where({ userId, conversationId: id }).select('id').first();
  return Boolean(member && await client.orm.public.Conversation.where({ id, deletedAt: null }).select('id').first());
}
export async function createDirectConversation(userId: number, peerId: number) {
  if (userId === peerId) throw new Error('Нельзя создать переписку с собой');
  const key = [userId, peerId].sort((a, b) => a - b).join(':');
  return db.transaction(async (tx) => {
    await lockResources(tx, [`direct:${key}`]);
    if (!await tx.orm.public.User.where({ id: peerId }).select('id').first()) throw new Error('Пользователь не найден');
    const existing = await tx.orm.public.Conversation.where({ directKey: key }).include('members').first();
    if (existing) {
      if (existing.members.length !== 2 || !existing.members.some((m) => m.userId === userId) || !existing.members.some((m) => m.userId === peerId)) throw new Error('Некорректный состав личного диалога');
      return existing;
    }
    const created = await tx.orm.public.Conversation.create({ directKey: key });
    await tx.orm.public.ConversationMember.create({ conversationId: created.id, userId });
    await tx.orm.public.ConversationMember.create({ conversationId: created.id, userId: peerId });
    return created;
  });
}
export async function listConversations(userId: number) {
  // Relation includes are batched by Prisma; the last-message branch is bounded per parent.
  const rows = await db.orm.public.Conversation.where({ deletedAt: null }).where((c) => c.members.some((m) => m.userId.eq(userId)))
    .include('members', (m) => m.include('user', (u) => u.select('id', 'username', 'avatarUrl')))
    .include('messages', (m) => m.where({ deletedAt: null }).orderBy((m) => m.id.desc()).limit(1))
    .all();
  return rows.map((row) => {
    const peer = row.members.find((member) => member.userId !== userId)?.user;
    if (row.kind !== 'group' && (!peer || row.members.length !== 2 || !row.directKey)) return null;
    const last = row.messages[0];
    return { id: row.id, kind: row.kind, title: row.title, avatarUrl: row.avatarUrl, memberCount: row.members.length, myRole: row.members.find((m) => m.userId === userId)?.role, peer: row.kind === 'group' ? { id: row.id, username: row.title ?? 'Группа', avatarUrl: row.avatarUrl } : peer!, preview: last ? messagePreview(last) : 'Сообщений пока нет',
      lastMessageId: last?.id ?? null, updatedAt: (last?.createdAt ?? row.createdAt).toString() };
  }).filter((row) => row !== null).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id);
}

// API routes and the custom Socket.IO server run in the same Node process.
const publisherKey = Symbol.for('mediachat.conversation-publisher');
type Publisher = (userIds: number[], id: number) => void | Promise<void>;
const publishers = globalThis as typeof globalThis & { [publisherKey]?: Publisher };
export function setConversationPublisher(publish: Publisher) { publishers[publisherKey] = publish; }
export async function publishConversation(userIds: number[], id: number) { await publishers[publisherKey]?.(userIds, id); }

// The owner may attach a fresh upload. An already published private file cannot
// be republished into another conversation, including the general chat.
export async function assertAttachmentScope(tx: MediaTransaction, urls: string[], id: number | null) {
  if (!urls.length) return;
  const [refs, albums] = await Promise.all([
    tx.orm.public.Message.where({ deletedAt: null }).where((m) => or(
      m.imageUrl.in(urls), m.audioUrl.in(urls), m.videoUrl.in(urls), m.documentUrl.in(urls),
    )).select('conversationId').all(),
    tx.orm.public.MessageImage.where((m) => m.imageUrl.in(urls)).include('message').all(),
  ]);
  if ([...refs, ...albums.filter((a) => !a.message.deletedAt).map((a) => a.message)]
    .some((ref) => !sameConversation(ref.conversationId, id))) throw new Error('Файл уже прикреплён к другой переписке. Выберите оригинал заново.');
}
