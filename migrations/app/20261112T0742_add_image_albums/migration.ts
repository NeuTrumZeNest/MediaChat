#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2666475c028e3dd68f5de636c7bb39e03989984c33e448301bf552f24ec75987/contract';
import startContract from '../../snapshots/2666475c028e3dd68f5de636c7bb39e03989984c33e448301bf552f24ec75987/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7c98ce92736f6b506142d6a275c79d2f1c7bc245bf12e970c4b1bee89d3e42a2/contract';
import endContract from '../../snapshots/7c98ce92736f6b506142d6a275c79d2f1c7bc245bf12e970c4b1bee89d3e42a2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'messageImage',
        columns: [
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('imageUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'messageImage',
        constraint: 'messageImage_messageId_position_key',
        columns: ['messageId', 'position'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'messageImage',
        constraint: 'messageImage_messageId_imageUrl_key',
        columns: ['messageId', 'imageUrl'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'messageImage',
        index: 'messageImage_imageUrl_idx_735a24f0',
        columns: ['imageUrl'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'messageImage',
        index: 'messageImage_messageId_idx_3cdded8d',
        columns: ['messageId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'messageImage',
        foreignKey: {
          name: 'messageImage_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
