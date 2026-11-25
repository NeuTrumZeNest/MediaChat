#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/34f4109a4680bb2c8b6c8a9be81aba2910acfdef83d258af7f0cb6ef794651e1/contract';
import startContract from '../../snapshots/34f4109a4680bb2c8b6c8a9be81aba2910acfdef83d258af7f0cb6ef794651e1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6612279b903bd02d12716743678cb6e73ba90d6a48fca3677288cf5441a68c67/contract';
import endContract from '../../snapshots/6612279b903bd02d12716743678cb6e73ba90d6a48fca3677288cf5441a68c67/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'mediaCleanupJob',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('ownerId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('deletedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'mediaCleanupJob',
        constraint: 'mediaCleanupJob_url_key',
        columns: ['url'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
