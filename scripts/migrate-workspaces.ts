// Backfills legacy single-source documents into workspaces.
//
//   bun run scripts/migrate-workspaces.ts --apply
//   bun run scripts/migrate-workspaces.ts --verify
//   bun run scripts/migrate-workspaces.ts --rollback
//
// The migration is intentionally additive and repeatable; the logic lives in
// src/lib/workspace-migration.ts so tests cover exactly what runs here.

import { prisma } from '../src/lib/db';
import {
  applyWorkspaceBackfill,
  rollbackToLegacyContent,
  verifyWorkspaceBackfill,
  type MigrationClient,
} from '../src/lib/workspace-migration';

type Mode = 'apply' | 'verify' | 'rollback';

function mode(): Mode {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--'));
  if (argument === '--verify') return 'verify';
  if (argument === '--rollback') return 'rollback';
  return 'apply';
}

const client = prisma as unknown as MigrationClient;

async function main() {
  const selected = mode();
  console.log('[migrate] mode=' + selected);

  if (selected === 'apply') {
    const report = await applyWorkspaceBackfill(client);
    console.log('[migrate] documents=' + report.documents + ' created=' + report.created +
      ' alreadyMigrated=' + report.alreadyMigrated + ' emptySource=' + report.emptySource);
    return;
  }

  if (selected === 'verify') {
    const report = await verifyWorkspaceBackfill(client, () => prisma.workspaceFile.count());
    console.log('[verify] documents=' + report.documents + ' workspaceFiles=' + report.workspaceFiles);
    if (report.problems.length > 0) {
      console.error('[verify] FAILED with ' + report.problems.length + ' problems:');
      for (const problem of report.problems.slice(0, 20)) console.error('  - ' + problem);
      process.exit(1);
    }
    console.log('[verify] OK: every document has a main file whose bytes match Document.content');
    return;
  }

  const report = await rollbackToLegacyContent(client);
  console.log('[rollback] restored Document.content for ' + report.restored + ' of ' + report.documents + ' documents');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('[migrate] failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
