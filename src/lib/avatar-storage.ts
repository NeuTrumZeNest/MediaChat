import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../prisma/db.ts';
export const AVATAR_DIR = join(process.cwd(), 'uploads', 'avatars');
export const avatarFilename = (url: string | null) => url && /^\/api\/avatars\/[0-9a-f-]{36}\.webp$/.test(url) ? url.split('/').pop()! : null;
export async function prepareAvatar(bytes: Uint8Array, mime: string, crop: unknown) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Аватарка должна быть от 1 байта до 10 МБ');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Выберите JPEG, PNG или WebP');
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || meta.pages && meta.pages > 1 || `image/${meta.format}` !== mime) throw new Error('Недопустимое содержимое изображения');
  const rotated = await image.rotate().toBuffer();
  const { width, height } = await sharp(rotated).metadata();
  if (!width || !height) throw new Error('Повреждённое изображение');
  const region = crop as { x?: unknown; y?: unknown; size?: unknown };
  if (!region || ![region.x, region.y, region.size].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Некорректная область обрезки');
  const { x, y, size } = region as { x: number; y: number; size: number };
  if (x < 0 || y < 0 || size <= 0 || x >= 1 || y >= 1 || size > 1) throw new Error('Область обрезки вне изображения');
  const side = Math.max(1, Math.floor(Math.min(width, height) * size));
  const left = Math.floor(x * width), top = Math.floor(y * height);
  if (left + side > width || top + side > height) throw new Error('Область обрезки вне изображения');
  return sharp(rotated).extract({ left, top, width: side, height: side }).resize(512, 512).webp({ quality: 85 }).toBuffer();
}
export async function writeAvatar(bytes: Buffer) {
  await mkdir(AVATAR_DIR, { recursive: true }); const name = `${randomUUID()}.webp`;
  await writeFile(join(AVATAR_DIR, name), bytes, { flag: 'wx' }); return `/api/avatars/${name}`;
}
export async function cleanupAvatar(url: string | null) {
  const name = avatarFilename(url); if (!name) return;
  const user = await db.orm.public.User.where({ avatarUrl: url }).select('id').first();
  const group = await db.orm.public.Conversation.where({ avatarUrl: url }).select('id').first();
  if (!user && !group) await rm(join(AVATAR_DIR, name), { force: true });
}
export async function avatarBytes(name: string) { return readFile(join(AVATAR_DIR, name)); }
const key = Symbol.for('mediachat.profile-publisher');
type Globals = typeof globalThis & { [key]?: (user: { id: number; username: string; avatarUrl: string | null }) => void };
export function setProfilePublisher(fn: NonNullable<Globals[typeof key]>) { (globalThis as Globals)[key] = fn; }
export function publishProfile(user: { id: number; username: string; avatarUrl: string | null }) { (globalThis as Globals)[key]?.(user); }

// Retry failed cleanup safely after a grace period; uploads still being attached
// cannot be collected. Unknown names and symlinks are never followed.
export async function sweepUnusedAvatars() {
  const names = await readdir(AVATAR_DIR).catch(() => [] as string[]);
  for (const name of names) {
    const url = `/api/avatars/${name}`;
    if (!avatarFilename(url)) continue;
    const file = await lstat(join(AVATAR_DIR, name)).catch(() => null);
    if (!file?.isFile() || Date.now() - file.mtimeMs < 24 * 60 * 60 * 1000) continue;
    await cleanupAvatar(url);
  }
}
