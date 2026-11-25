#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0f3859b2e44dbd42963a5baefe571f09038f208fc1b965fbac3d2cd5b9f50cea/contract';
import endContract from '../../snapshots/0f3859b2e44dbd42963a5baefe571f09038f208fc1b965fbac3d2cd5b9f50cea/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/49a07dbf2c849d23321c1535145645e5a07dfbd05ac621a182a44dbf7e27d73f/contract';
import startContract from '../../snapshots/49a07dbf2c849d23321c1535145645e5a07dfbd05ac621a182a44dbf7e27d73f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('clientMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('documentUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'message',
        constraint: 'message_clientMessageId_key',
        columns: ['clientMessageId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
