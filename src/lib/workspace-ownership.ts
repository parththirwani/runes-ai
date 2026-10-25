// Workspace ownership backfill and default-workspace service.
//
// `Workspace` here means a COLLECTION OF DOCUMENTS (see prisma/schema.prisma). It is a
// different concept from `WorkspaceFile`, which is one file inside a single document.
//
// Two audiences use this module:
//   1. `scripts/migrate-workspace-ownership.ts`, which runs the same SQL the migration uses
//      so operators can rehearse, re-run, and verify the backfill without redeploying.
//   2. The sign-in path, through `ensureDefaultPersonalWorkspace`, so a user who existed
//      before this feature and a user who signs in for the first time both end up with
//      exactly one default personal workspace.
//
// Every statement is idempotent: a second run reports zero changed rows.

import { Prisma } from "../generated/prisma/client";

/** Structural type for the raw-SQL surface the backfill needs (Prisma or a test fake). */
export type RawClient = {
  $executeRawUnsafe: (query: string) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T[]>;
};

export type OwnershipCounts = {
  users: number;
  defaultPersonalWorkspaces: number;
  documents: number;
  unassignedDocuments: number;
  misassignedDocuments: number;
  ownersWithMultipleDefaults: number;
  ownersWithNonDefaultDocuments: number;
  documentsOwnedByNonOwnerOfWorkspace: number;
};

export type BackfillReport = {
  createdDefaultWorkspaces: number;
  assignedDocuments: number;
  counts: OwnershipCounts;
  problems: string[];
};

export type VerifyReport = { counts: OwnershipCounts; problems: string[] };

/** One default personal workspace per user that does not have one yet. */
export const SQL_INSERT_MISSING_DEFAULT_PERSONAL_WORKSPACES = `
INSERT INTO "workspaces" ("id", "name", "kind", "ownerUserId", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Personal', 'PERSONAL', u."id", true, now(), now()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" w
  WHERE w."ownerUserId" = u."id" AND w."kind" = 'PERSONAL' AND w."isDefault" IS TRUE
)`;

/** Assign every document without a workspace to its author's default personal workspace. */
export const SQL_ASSIGN_UNASSIGNED_DOCUMENTS = `
UPDATE "documents" d
SET "workspaceId" = w."id"
FROM "workspaces" w
WHERE d."workspaceId" IS NULL
  AND w."kind" = 'PERSONAL'
  AND w."isDefault" IS TRUE
  AND w."ownerUserId" = d."userId"`;

const SQL_COUNTS = `
SELECT
  (SELECT COUNT(*)::int FROM "users") AS "users",
  (SELECT COUNT(*)::int FROM "workspaces" WHERE "kind" = 'PERSONAL' AND "isDefault" IS TRUE) AS "defaultPersonalWorkspaces",
  (SELECT COUNT(*)::int FROM "documents") AS "documents",
  (SELECT COUNT(*)::int FROM "documents" WHERE "workspaceId" IS NULL) AS "unassignedDocuments",
  (SELECT COUNT(*)::int FROM "documents" d LEFT JOIN "workspaces" w ON w."id" = d."workspaceId"
     WHERE d."workspaceId" IS NOT NULL AND w."ownerUserId" IS DISTINCT FROM d."userId" AND w."kind" = 'PERSONAL') AS "misassignedDocuments",
  (SELECT COUNT(*)::int FROM (
     SELECT "ownerUserId" FROM "workspaces" WHERE "kind" = 'PERSONAL' AND "isDefault" IS TRUE
     GROUP BY "ownerUserId" HAVING COUNT(*) > 1) multi) AS "ownersWithMultipleDefaults",
  (SELECT COUNT(*)::int FROM "documents" d JOIN "workspaces" w ON w."id" = d."workspaceId"
     WHERE w."kind" = 'PERSONAL' AND w."ownerUserId" = d."userId" AND w."isDefault" IS NOT TRUE) AS "ownersWithNonDefaultDocuments",
  (SELECT COUNT(*)::int FROM "documents" d JOIN "workspaces" w ON w."id" = d."workspaceId"
     WHERE w."kind" = 'PERSONAL' AND w."ownerUserId" IS DISTINCT FROM d."userId") AS "documentsOwnedByNonOwnerOfWorkspace"`;

export async function countOwnership(client: RawClient): Promise<OwnershipCounts> {
  const rows = await client.$queryRawUnsafe<OwnershipCounts>(SQL_COUNTS);
  return rows[0];
}

/** Creates missing default personal workspaces and assigns unassigned documents. */
export async function applyOwnershipBackfill(client: RawClient): Promise<BackfillReport> {
  const createdDefaultWorkspaces = await client.$executeRawUnsafe(SQL_INSERT_MISSING_DEFAULT_PERSONAL_WORKSPACES);
  const assignedDocuments = await client.$executeRawUnsafe(SQL_ASSIGN_UNASSIGNED_DOCUMENTS);
  const verified = await verifyOwnership(client);
  return { createdDefaultWorkspaces, assignedDocuments, ...verified };
}

/**
 * Verifies the invariant the permission layer depends on: every document sits in exactly
 * one workspace, a personal workspace's default document set belongs to its owner, and no
 * user has more than one default personal workspace.
 */
export async function verifyOwnership(client: RawClient): Promise<VerifyReport> {
  const counts = await countOwnership(client);
  const problems: string[] = [];

  if (counts.users !== counts.defaultPersonalWorkspaces) {
    problems.push(
      `expected one default personal workspace per user, found ${counts.defaultPersonalWorkspaces} for ${counts.users} users`,
    );
  }
  if (counts.ownersWithMultipleDefaults > 0) {
    problems.push(`${counts.ownersWithMultipleDefaults} user(s) have more than one default personal workspace`);
  }
  if (counts.unassignedDocuments > 0) {
    problems.push(`${counts.unassignedDocuments} document(s) have no workspace`);
  }
  if (counts.misassignedDocuments > 0) {
    problems.push(`${counts.misassignedDocuments} document(s) sit in another user's personal workspace`);
  }
  if (counts.documentsOwnedByNonOwnerOfWorkspace > 0) {
    problems.push(`${counts.documentsOwnedByNonOwnerOfWorkspace} document(s) are in a personal workspace their author does not own`);
  }

  return { counts, problems };
}

export type DefaultWorkspaceResult = { workspaceId: string; created: boolean };

/**
 * Runtime counterpart of the backfill: idempotent, safe under concurrent first requests.
 * The database partial unique index `workspaces_one_default_personal_per_owner` is the
 * arbiter; a losing concurrent insert re-reads the winning row instead of failing.
 */
export async function ensureDefaultPersonalWorkspace(
  client: Prisma.TransactionClient,
  userId: string,
): Promise<DefaultWorkspaceResult> {
  const existing = await client.workspace.findFirst({
    where: { ownerUserId: userId, kind: "PERSONAL", isDefault: true },
    select: { id: true },
  });
  if (existing) return { workspaceId: existing.id, created: false };

  try {
    const created = await client.workspace.create({
      data: { name: "Personal", kind: "PERSONAL", ownerUserId: userId, isDefault: true },
      select: { id: true },
    });
    return { workspaceId: created.id, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await client.workspace.findFirst({
        where: { ownerUserId: userId, kind: "PERSONAL", isDefault: true },
        select: { id: true },
      });
      if (winner) return { workspaceId: winner.id, created: false };
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
