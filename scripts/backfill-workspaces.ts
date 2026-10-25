// Backfills collection workspaces for preexisting users and documents.
//
//   bun run scripts/backfill-workspaces.ts --apply
//   bun run scripts/backfill-workspaces.ts --verify
//
// Additive and repeatable: it only ever creates a missing default personal workspace and only
// ever fills a NULL documents."workspaceId". The decision logic lives in
// src/lib/workspaces-backfill.ts so tests exercise exactly what runs here; this file is the SQL
// adapter, which has to be raw SQL because the column is nullable during the backfill window
// while the Prisma schema already declares it required.

import { prisma } from '../src/lib/db';
import {
  applyWorkspaceBackfill,
  verifyWorkspaceBackfill,
  DEFAULT_PERSONAL_WORKSPACE_NAME,
  type BackfillClient,
  type BackfillDocumentRow,
  type BackfillMemberRow,
  type BackfillWorkspaceRow,
} from '../src/lib/workspaces-backfill';

type Mode = 'apply' | 'verify';

function mode(): Mode {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--'));
  if (argument === undefined || argument === '--apply') return 'apply';
  if (argument === '--verify') return 'verify';
  throw new Error('Unknown mode ' + argument + '; use --apply or --verify');
}

const client: BackfillClient = {
  users: async () => prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "users" ORDER BY "id"`,

  defaultPersonalWorkspaces: async () => prisma.$queryRaw<{ id: string; ownerUserId: string | null }[]>`
    SELECT "id", "ownerUserId" FROM "workspaces" WHERE "kind" = 'PERSONAL' AND "isDefault" = true AND "ownerUserId" IS NOT NULL ORDER BY "id"`,

  createDefaultPersonalWorkspace: async (userId) => {
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "workspaces" ("id", "name", "kind", "ownerUserId", "isDefault")
      SELECT gen_random_uuid()::text, ${DEFAULT_PERSONAL_WORKSPACE_NAME}, 'PERSONAL', ${userId}, true
      WHERE NOT EXISTS (
        SELECT 1 FROM "workspaces" WHERE "kind" = 'PERSONAL' AND "isDefault" = true AND "ownerUserId" = ${userId}
      )
      ON CONFLICT DO NOTHING
      RETURNING "id"`;
    if (inserted.length > 0) return { id: inserted[0].id, created: true };
    // The partial unique index won a race with a concurrent sign-in: reuse its row.
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "workspaces" WHERE "kind" = 'PERSONAL' AND "isDefault" = true AND "ownerUserId" = ${userId} LIMIT 1`;
    if (existing.length === 0) throw new Error('default personal workspace vanished for user ' + userId);
    return { id: existing[0].id, created: false };
  },

  unassignedDocuments: async () => prisma.$queryRaw<BackfillDocumentRow[]>`
    SELECT "id", "userId", "workspaceId", "slug" FROM "documents" WHERE "workspaceId" IS NULL ORDER BY "id"`,

  assignDocument: async (documentId, workspaceId) => {
    const result = await prisma.$executeRaw`
      UPDATE "documents" SET "workspaceId" = ${workspaceId}
      WHERE "id" = ${documentId} AND "workspaceId" IS NULL`;
    return result;
  },

  allWorkspaces: async () => prisma.$queryRaw<BackfillWorkspaceRow[]>`
    SELECT "id", "kind"::text AS "kind", "ownerUserId", "teamId", "isDefault" FROM "workspaces" ORDER BY "id"`,

  allDocuments: async () => prisma.$queryRaw<BackfillDocumentRow[]>`
    SELECT "id", "userId", "workspaceId", "slug" FROM "documents" ORDER BY "id"`,

  activeMemberships: async () => prisma.$queryRaw<BackfillMemberRow[]>`
    SELECT "teamId", "userId" FROM "team_members" WHERE "active" = true`,
};

async function main() {
  const selected = mode();
  console.log('[backfill:workspaces] mode=' + selected);

  if (selected === 'apply') {
    const report = await applyWorkspaceBackfill(client);
    console.log('[backfill:workspaces] users=' + report.users +
      ' defaultWorkspacesCreated=' + report.defaultWorkspacesCreated +
      ' documentsAssigned=' + report.documentsAssigned +
      ' documentsAlreadyAssigned=' + report.documentsAlreadyAssigned);
    if (report.documentsWithoutDefaultWorkspace.length > 0) {
      console.error('[backfill:workspaces] ' + report.documentsWithoutDefaultWorkspace.length +
        ' document(s) have no author default workspace: ' + report.documentsWithoutDefaultWorkspace.slice(0, 20).join(', '));
      process.exit(1);
    }
    return;
  }

  const report = await verifyWorkspaceBackfill(client);
  console.log('[verify:workspaces] users=' + report.users +
    ' defaultPersonalWorkspaces=' + report.defaultPersonalWorkspaces +
    ' documents=' + report.documents +
    ' unassigned=' + report.unassigned +
    ' misassigned=' + report.misassigned);
  if (report.problems.length > 0) {
    console.error('[verify:workspaces] FAILED with ' + report.problems.length + ' problems:');
    for (const problem of report.problems.slice(0, 20)) console.error('  - ' + problem);
    process.exit(1);
  }
  console.log('[verify:workspaces] OK: one default personal workspace per user, every document in a workspace its author can author in');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('[backfill:workspaces] failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
