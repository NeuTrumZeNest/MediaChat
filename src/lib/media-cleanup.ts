import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../prisma/db.ts';
import { lockResources, mediaResource, type MediaTransaction } from './media-locks.ts';

export const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const patterns = {
  images: new RegExp(`^(${uuid})\\.(png|jpg|webp|gif)$`),
  audio: new RegExp(`^(${uuid})\\.(mp3|wav|flac)$`),
  videos: new RegExp(`^(${uuid})\\.(mp4|webm)$`),
  documents: new RegExp(`^(${uuid})\\.(pdf|txt|csv|docx|xlsx|pptx|zip|bin)$`),
};
type Kind = keyof typeof patterns;
export type CleanupStatus = 'deleted' | 'would-delete' | 'referenced' | 'recent' | 'unverified' | 'absent';
export type CleanupResult = { url: string; status: CleanupStatus; bytes: number };

export function mediaFiles(url: string, root = join(process.cwd(), 'uploads')) {
  const match = /^\/api\/(images|audio|videos|documents)\/([^/]+)$/.exec(url);
  if (!match) return null;
  const kind = match[1] as Kind, parsed = patterns[kind].exec(match[2]);
  if (!parsed) return null;
  const directory = kind === 'images' ? root : join(root, kind);
  const original = join(directory, match[2]), metadata = join(directory, 'metadata', `${parsed[1]}.json`);
  const derivative = kind === 'images' ? join(root, 'previews', `${parsed[1]}.webp`) : kind === 'videos' ? join(directory, 'posters', `${parsed[1]}.jpg`) : null;
  return { kind, id: parsed[1], filename: match[2], original, metadata, files: [original, ...(derivative ? [derivative] : []), metadata] };
}

export async function hasMediaReferences(tx: MediaTransaction, url: string): Promise<boolean> {
  const id = mediaFiles(url)?.id;
  if (!id) return true;
  // UUID учитывает также исторические относительные/абсолютные URL того же файла.
  // Ложное совпадение сохраняет файл, но никогда не даёт права удалить используемый.
  const pattern = `%${id}%`;
  if (await tx.orm.public.Message.where({ deletedAt: null }).where((message) => message.imageUrl.like(pattern)).select('id').first()) return true;
  if (await tx.orm.public.Message.where({ deletedAt: null }).where((message) => message.audioUrl.like(pattern)).select('id').first()) return true;
  if (await tx.orm.public.Message.where({ deletedAt: null }).where((message) => message.videoUrl.like(pattern)).select('id').first()) return true;
  if (await tx.orm.public.Message.where({ deletedAt: null }).where((message) => message.documentUrl.like(pattern)).select('id').first()) return true;
  const albums = await tx.orm.public.MessageImage.where((image) => image.imageUrl.like(pattern)).include('message').all();
  return albums.some((image) => image.message.deletedAt === null);
}

async function statIfExists(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function cleanupLocked(tx: MediaTransaction, url: string, ownerId: number, apply: boolean, minAgeMs: number, root: string): Promise<CleanupResult> {
  const paths = mediaFiles(url, root);
  if (!paths) return { url, status: 'unverified', bytes: 0 };
  if (await hasMediaReferences(tx, url)) return { url, status: 'referenced', bytes: 0 };
  const stats = await Promise.all(paths.files.map(statIfExists));
  const bytes = stats.reduce((sum, value) => sum + (value?.isFile() ? value.size : 0), 0);
  if (stats.every((value) => value === null)) return { url, status: 'absent', bytes: 0 };
  if (stats.some((value) => value && !value.isFile())) return { url, status: 'unverified', bytes };
  if (stats.some((value) => value && Date.now() - value.mtimeMs < minAgeMs)) return { url, status: 'recent', bytes };
  let metadata;
  try { metadata = JSON.parse(await readFile(paths.metadata, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return { url, status: 'unverified', bytes };
    throw error;
  }
  if (metadata.id !== paths.id || metadata.ownerId !== ownerId || !Number.isSafeInteger(ownerId) || ownerId <= 0 ||
      (paths.kind === 'images' ? `${metadata.id}.${metadata.extension}` !== paths.filename : metadata.filename !== paths.filename)) {
    return { url, status: 'unverified', bytes };
  }
  if (!apply) return { url, status: 'would-delete', bytes };
  // Метаданные последними: после частичного сбоя остаётся основание безопасно повторить удаление.
  for (const path of paths.files) await rm(path, { force: true });
  return { url, status: 'deleted', bytes };
}

export async function cleanupMedia(url: string, ownerId: number, options: { apply?: boolean; minAgeMs?: number; root?: string } = {}) {
  return db.transaction(async (tx) => {
    await lockResources(tx, [mediaResource(url)]);
    return cleanupLocked(tx, url, ownerId, options.apply ?? false, options.minAgeMs ?? 0, options.root ?? join(process.cwd(), 'uploads'));
  });
}

export async function processCleanupJobs(urls?: string[]) {
  const jobs = urls
    ? (await Promise.all([...new Set(urls)].map((url) => db.orm.public.MediaCleanupJob.where({ url }).first()))).filter((job) => job !== null)
    : await db.orm.public.MediaCleanupJob.orderBy((job) => job.attempts.asc()).limit(100).all();
  const results: CleanupResult[] = [];
  for (const job of jobs) {
    if (urls && !urls.includes(job.url)) continue;
    try {
      const result = await db.transaction(async (tx) => {
        await lockResources(tx, [mediaResource(job.url)]);
        const result = await cleanupLocked(tx, job.url, job.ownerId, true, 0, join(process.cwd(), 'uploads'));
        if (['deleted', 'absent', 'referenced'].includes(result.status)) await tx.orm.public.MediaCleanupJob.where({ id: job.id }).delete();
        else await tx.orm.public.MediaCleanupJob.where({ id: job.id }).update({ attempts: job.attempts + 1, lastError: result.status });
        return result;
      });
      results.push(result);
    } catch (error) {
      await db.orm.public.MediaCleanupJob.where({ id: job.id }).update({ attempts: job.attempts + 1, lastError: (error as Error).message.slice(0, 500) });
    }
  }
  return results;
}

export async function sweepOrphanMedia({ apply = false, root = join(process.cwd(), 'uploads') } = {}) {
  const results: CleanupResult[] = [];
  for (const kind of Object.keys(patterns) as Kind[]) {
    const directory = kind === 'images' ? root : join(root, kind);
    let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const candidates = new Set(names);
    let metaNames: string[] = [];
    try { metaNames = await readdir(join(directory, 'metadata')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const metaName of metaNames) {
      if (!new RegExp(`^${uuid}\\.json$`).test(metaName)) continue;
      try {
        const metadata = JSON.parse(await readFile(join(directory, 'metadata', metaName), 'utf8'));
        if (`${metadata.id}.json` !== metaName) continue;
        const name = kind === 'images' ? `${metadata.id}.${metadata.extension}` : metadata.filename;
        if (typeof name === 'string' && patterns[kind].test(name)) candidates.add(name);
      } catch { /* Непроверенные метаданные не дают права удалять файлы. */ }
    }
    for (const name of candidates) {
      if (!patterns[kind].test(name)) continue;
      const url = `/api/${kind}/${name}`, paths = mediaFiles(url, root)!;
      const stat = await statIfExists(paths.original) || await statIfExists(paths.metadata);
      if (!stat?.isFile() || Date.now() - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
      let metadata;
      try { metadata = JSON.parse(await readFile(paths.metadata, 'utf8')); }
      catch { results.push({ url, status: 'unverified', bytes: stat.size }); continue; }
      results.push(await cleanupMedia(url, metadata.ownerId, { apply, minAgeMs: ORPHAN_GRACE_MS, root }));
    }
    if (kind !== 'videos' && kind !== 'documents') continue;
    const staging = join(directory, 'staging');
    let staged: string[];
    try { staged = await readdir(staging); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const stagePattern = new RegExp(`^${uuid}\\.(mp4|webm|pdf|txt|csv|docx|xlsx|pptx|zip|bin|json|jpg)$`);
    for (const name of staged) {
      if (!stagePattern.test(name)) continue;
      const path = join(staging, name), stat = await statIfExists(path);
      if (!stat?.isFile() || Date.now() - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
      if (apply) await rm(path, { force: true });
      results.push({ url: `${kind}/staging/${name}`, status: apply ? 'deleted' : 'would-delete', bytes: stat.size });
    }
  }
  return results;
}
