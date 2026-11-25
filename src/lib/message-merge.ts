import type { ReplySummary } from './message-actions.ts';
export type MessageEdit = { id: number; text: string; editedAt: string | null; replyPreview?: string };
const version = (message: { editedAt?: string | null }) => message.editedAt ? Date.parse(message.editedAt) : 0;
export function mergeMessageHistory<T extends { id: number; text: string; editedAt?: string | null; replyToId?: number | null; replyTo?: ReplySummary | null }>(current: T[], incoming: T[], edits: Map<number, MessageEdit> = new Map(), deleted: Set<number> = new Set()): T[] {
  const result = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (deleted.has(message.id)) continue;
    const previous = result.get(message.id);
    if (!previous || version(message) >= version(previous)) result.set(message.id, message);
  }
  return [...result.values()].filter((message) => !deleted.has(message.id)).map((message) => {
    const edit = edits.get(message.id);
    const merged = edit && version(edit) >= version(message) ? { ...message, ...edit } : message;
    const sourceEdit = merged.replyToId ? edits.get(merged.replyToId) : undefined;
    const quoted = sourceEdit?.replyPreview !== undefined && merged.replyTo &&
      version(sourceEdit) >= version(merged.replyTo)
      ? { ...merged, replyTo: { ...merged.replyTo, preview: sourceEdit.replyPreview, editedAt: sourceEdit.editedAt } } : merged;
    return quoted.replyToId && deleted.has(quoted.replyToId) ? { ...quoted, replyTo: { id: quoted.replyToId, author: 'Сообщение удалено', preview: '' } } : quoted;
  }).sort((a, b) => a.id - b.id);
}
