export type GroupRole = 'owner' | 'admin' | 'member';
export function canManageMember(actor: string, target: string) {
  return actor === 'owner' ? target !== 'owner' : actor === 'admin' && target === 'member';
}
export function groupTitle(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Название группы: от 1 до 80 символов');
  return value.trim();
}
