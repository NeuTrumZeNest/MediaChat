#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3a0162b4aa580bfed3b3a33473e6e62d0aad6cde5ac062c90fd271e5a34855a8/contract';
import startContract from '../../snapshots/3a0162b4aa580bfed3b3a33473e6e62d0aad6cde5ac062c90fd271e5a34855a8/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6058942097e72acd1063db425d65e5d7a7df37021b4e9510c305b3b962f931ab/contract';
import endContract from '../../snapshots/6058942097e72acd1063db425d65e5d7a7df37021b4e9510c305b3b962f931ab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('imageUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
