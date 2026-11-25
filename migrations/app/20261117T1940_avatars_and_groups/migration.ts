#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/ec313e38c603aa40dcd2fa5b502176f554a9ae2500eecfa28a314c259008f9d3/contract';
import startContract from '../../snapshots/ec313e38c603aa40dcd2fa5b502176f554a9ae2500eecfa28a314c259008f9d3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f9e07904c410b4591c5fff2ec8f1ce74358e090f6aad4dc4c4613ae2b718fe68/contract';
import endContract from '../../snapshots/f9e07904c410b4591c5fff2ec8f1ce74358e090f6aad4dc4c4613ae2b718fe68/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'conversation',
        column: col('avatarUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'conversation',
        column: col('deletedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'conversation',
        column: col('kind', 'text', {
          notNull: true,
          default: lit('direct'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'conversation',
        column: col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'conversationMember',
        column: col('role', 'text', {
          notNull: true,
          default: lit('member'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('avatarUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
