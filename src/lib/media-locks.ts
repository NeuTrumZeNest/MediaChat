import { db } from '../prisma/db.ts';
export type MediaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Общие для сервера и CLI PostgreSQL-locks: очистка не может опередить
// проверку владельца/запись нового сообщения с тем же файлом.
export async function lockResources(tx: MediaTransaction, resources: string[]) {
  for (const resource of [...new Set(resources)].sort()) {
    const key = `mediachat:${resource}`;
    const plan = db.raw.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      .returnsRow({ locked: 'pg/int4@1' }).build();
    await tx.query(plan);
  }
}
export const mediaResource = (url: string) => `media:${url}`;
export const messageResource = (id: number) => `message:${id}`;
