#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0f3859b2e44dbd42963a5baefe571f09038f208fc1b965fbac3d2cd5b9f50cea/contract';
import startContract from '../../snapshots/0f3859b2e44dbd42963a5baefe571f09038f208fc1b965fbac3d2cd5b9f50cea/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/2666475c028e3dd68f5de636c7bb39e03989984c33e448301bf552f24ec75987/contract';
import endContract from '../../snapshots/2666475c028e3dd68f5de636c7bb39e03989984c33e448301bf552f24ec75987/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('videoUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_videoUrl_idx_c4d39b7f',
        columns: ['videoUrl'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
