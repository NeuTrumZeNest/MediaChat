import { cleanupAvatar } from './avatar-storage.ts';
import { Temporal } from 'temporal-polyfill';
import { db } from '../prisma/db.ts';
import { lockResources } from './media-locks.ts';
import { canManageMember, groupTitle } from './group-policy.ts';
import { conversationId, publishConversation } from './conversations.ts';
export const conversationResource = (id: number) => `conversation:${id}`;
export async function groupInfo(userId: number, id: number) {
  const row = await db.orm.public.Conversation.where({ id, kind: 'group', deletedAt: null })
    .include('members', (m) => m.include('user', (u) => u.select('id', 'username', 'avatarUrl'))).first();
  if (!row || !row.members.some((m) => m.userId === userId)) throw new Error('Группа недоступна');
  return { id: row.id, title: row.title!, avatarUrl: row.avatarUrl,
    members: row.members.map((m) => ({ ...m.user, role: m.role })), myRole: row.members.find((m) => m.userId === userId)!.role };
}
export async function createGroup(userId: number, title: unknown, participants: unknown) {
  const name = groupTitle(title);
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 49) throw new Error('Выберите от 1 до 49 участников');
  const ids = [...new Set([userId, ...participants.map((id) => conversationId(id))])];
  if (ids.some((id) => id === null) || ids.length < 2) throw new Error('Некорректные участники');
  const members = ids as number[];
  const row = await db.transaction(async (tx) => {
    const users = await tx.orm.public.User.where((u) => u.id.in(members)).select('id').all();
    if (users.length !== members.length) throw new Error('Пользователь не найден');
    const group = await tx.orm.public.Conversation.create({ kind: 'group', title: name });
    for (const id of members) await tx.orm.public.ConversationMember.create({ conversationId: group.id, userId: id, role: id === userId ? 'owner' : 'member' });
    return group;
  });
  await publishConversation(members, row.id); return row.id;
}
export async function changeGroup(userId: number, id: number, action: unknown, value: unknown) {
  let obsoleteAvatar: string | null = null;
  const affected = await db.transaction(async (tx) => {
    await lockResources(tx, [conversationResource(id)]);
    const group = await tx.orm.public.Conversation.where({ id, kind: 'group', deletedAt: null }).include('members').first();
    const actor = group?.members.find((m) => m.userId === userId);
    if (!group || !actor) throw new Error('Группа недоступна');
    const ids = group.members.map((m) => m.userId);
    if (action === 'title') {
      if (actor.role === 'member') throw new Error('Недостаточно прав');
      await tx.orm.public.Conversation.where({ id }).update({ title: groupTitle(value) });
    } else if (action === 'delete') {
      if (actor.role !== 'owner') throw new Error('Только владелец может удалить группу');
      // Preserve messages and uploads; the deleted conversation becomes inaccessible.
      obsoleteAvatar = group.avatarUrl;
      await tx.orm.public.Conversation.where({ id }).update({ avatarUrl: null, deletedAt: Temporal.Instant.fromEpochMilliseconds(Date.now()) });
      await tx.orm.public.ConversationMember.where({ conversationId: id }).delete();
    } else if (action === 'leave') {
      if (actor.role === 'owner') throw new Error('Сначала передайте владение или удалите группу');
      await tx.orm.public.ConversationMember.where({ id: actor.id }).delete();
    } else {
      const targetId = conversationId(value);
      if (!targetId) throw new Error('Укажите пользователя');
      const target = group.members.find((m) => m.userId === targetId);
      if (action === 'add') {
        if (actor.role === 'member') throw new Error('Недостаточно прав');
        if (target) return ids;
        if (ids.length >= 50) throw new Error('В группе допускается до 50 участников');
        if (!await tx.orm.public.User.where({ id: targetId }).select('id').first()) throw new Error('Пользователь не найден');
        await tx.orm.public.ConversationMember.create({ conversationId: id, userId: targetId, role: 'member' }); ids.push(targetId);
      } else if (action === 'transfer') {
        if (actor.role !== 'owner' || !target || targetId === userId) throw new Error('Передать владение можно другому участнику');
        await tx.orm.public.ConversationMember.where({ id: actor.id }).update({ role: 'admin' });
        await tx.orm.public.ConversationMember.where({ id: target.id }).update({ role: 'owner' });
      } else if (action === 'remove' || action === 'admin' || action === 'member') {
        if (!target || !canManageMember(actor.role, target.role) || (action !== 'remove' && actor.role !== 'owner')) throw new Error('Недостаточно прав');
        if (action === 'remove') await tx.orm.public.ConversationMember.where({ id: target.id }).delete();
        else await tx.orm.public.ConversationMember.where({ id: target.id }).update({ role: action });
      } else throw new Error('Неизвестное действие');
    }
    return ids;
  });
  await publishConversation(affected, id);
  if (obsoleteAvatar) await cleanupAvatar(obsoleteAvatar).catch((error) => console.error('Очистка аватарки будет повторена:', error));
}
