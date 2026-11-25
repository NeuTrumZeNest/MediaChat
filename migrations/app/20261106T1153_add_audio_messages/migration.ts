#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/227ffab0db924d9db4715f94d9906f19732580e64bb9a6fa820d1d88cefa80fc/contract';
import startContract from '../../snapshots/227ffab0db924d9db4715f94d9906f19732580e64bb9a6fa820d1d88cefa80fc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/49a07dbf2c849d23321c1535145645e5a07dfbd05ac621a182a44dbf7e27d73f/contract';
import endContract from '../../snapshots/49a07dbf2c849d23321c1535145645e5a07dfbd05ac621a182a44dbf7e27d73f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('audioUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
