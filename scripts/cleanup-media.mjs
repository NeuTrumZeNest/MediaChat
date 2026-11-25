// Default is a read-only report. --apply removes only verified, unreferenced app copies.
import { db } from '../src/prisma/db.ts';
import { cleanupMedia, processCleanupJobs, sweepOrphanMedia } from '../src/lib/media-cleanup.ts';
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--apply')) throw new Error('Использование: npm run media:cleanup [-- --apply]');
const apply = flags.includes('--apply');
try {
  const pending = await db.orm.public.MediaCleanupJob.select('id', 'url', 'ownerId', 'attempts', 'lastError').all();
  const jobs = apply ? await processCleanupJobs() : await Promise.all(pending.map((job) => cleanupMedia(job.url, job.ownerId)));
  const files = await sweepOrphanMedia({ apply });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', pending, jobs, files,
    bytes: [...jobs, ...files].filter((item) => item.status === 'deleted' || item.status === 'would-delete').reduce((sum, item) => sum + item.bytes, 0),
  }, null, 2));
} finally { await db.close(); }
