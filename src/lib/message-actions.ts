export type MessagePreviewSource = {
  id: number; text: string; userId: number; deletedAt?: unknown; editedAt?: { toString(): string } | string | null; conversationId?: number | null;
  imageUrl?: string | null; imageUrls?: string[]; images?: unknown[];
  audioUrl?: string | null; videoUrl?: string | null; documentUrl?: string | null;
};
export type ReplySummary = { id: number; author: string; preview: string; editedAt?: string | null };

export function messagePreview(message: Partial<MessagePreviewSource>): string {
  if (message.deletedAt) return 'Сообщение удалено';
  if (message.text?.trim()) return message.text.trim().replace(/\s+/g, ' ').slice(0, 180);
  const count = message.imageUrls?.length || message.images?.length || (message.imageUrl ? 1 : 0);
  if (count) return count > 1 ? `Альбом · ${count} фото` : 'Изображение';
  if (message.videoUrl) return 'Видео';
  if (message.audioUrl) return 'Аудиофайл';
  if (message.documentUrl) return 'Файл';
  return 'Сообщение';
}

export function hasMessageAttachments(message: Partial<MessagePreviewSource>): boolean {
  return Boolean(message.imageUrl || message.imageUrls?.length || message.images?.length || message.audioUrl || message.videoUrl || message.documentUrl);
}

export function isTextOnly(message: Partial<MessagePreviewSource>): boolean {
  return !message.deletedAt && Boolean(message.text?.trim()) && !hasMessageAttachments(message);
}

export function canEditMessageText(message: Partial<MessagePreviewSource>): boolean {
  return !message.deletedAt && (Boolean(message.text?.trim()) || hasMessageAttachments(message));
}

export function sameConversation(a: number | null | undefined, b: number | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export function summarizeReply(source: (MessagePreviewSource & { user?: { username: string } | null }) | null | undefined, conversationId: number | null): ReplySummary | null {
  if (!source || !sameConversation(source.conversationId, conversationId)) return null;
  if (source.deletedAt) return { id: source.id, author: 'Сообщение удалено', preview: '' };
  return { id: source.id, author: source.user?.username ?? 'Неизвестный пользователь', preview: messagePreview(source), editedAt: source.editedAt?.toString() ?? null };
}

export function parseMessageId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Некорректный идентификатор сообщения');
  return value;
}

export function messageRoom(conversationId: number | null): string {
  return conversationId === null ? 'general' : `conversation:${conversationId}`;
}

// Стабильный порядок событий даже при двух правках за одну миллисекунду.
export function nextEditMillis(previous: string | null, now = Date.now()): number {
  const old = previous ? Date.parse(previous) : 0;
  return Math.max(now, (Number.isFinite(old) ? old : 0) + 1);
}
