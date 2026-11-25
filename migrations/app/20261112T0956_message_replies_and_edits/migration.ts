#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/34f4109a4680bb2c8b6c8a9be81aba2910acfdef83d258af7f0cb6ef794651e1/contract';
import endContract from '../../snapshots/34f4109a4680bb2c8b6c8a9be81aba2910acfdef83d258af7f0cb6ef794651e1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7c98ce92736f6b506142d6a275c79d2f1c7bc245bf12e970c4b1bee89d3e42a2/contract';
import startContract from '../../snapshots/7c98ce92736f6b506142d6a275c79d2f1c7bc245bf12e970c4b1bee89d3e42a2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('editedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('replyToId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_replyToId_idx_f2e7fcdc',
        columns: ['replyToId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_replyToId_fkey',
          columns: ['replyToId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
