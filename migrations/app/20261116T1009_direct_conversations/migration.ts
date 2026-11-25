#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6612279b903bd02d12716743678cb6e73ba90d6a48fca3677288cf5441a68c67/contract';
import startContract from '../../snapshots/6612279b903bd02d12716743678cb6e73ba90d6a48fca3677288cf5441a68c67/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec313e38c603aa40dcd2fa5b502176f554a9ae2500eecfa28a314c259008f9d3/contract';
import endContract from '../../snapshots/ec313e38c603aa40dcd2fa5b502176f554a9ae2500eecfa28a314c259008f9d3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'conversation',
        column: col('directKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'conversation',
        constraint: 'conversation_directKey_key',
        columns: ['directKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_conversationId_id_idx_43aff5d1',
        columns: ['conversationId', 'id'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
