// Idempotent backfill that places every document in its author's default personal workspace.
//
// The pure logic here runs from scripts/backfill-workspaces.ts and from the integration tests.
// It never rewrites an assignment that already exists, which is what makes a second pass a no-op
// and what keeps a repair run safe in production.
//
// The client is a narrow port rather than a Prisma delegate: during the backfill window the
// database column documents."workspaceId" is nullable while the Prisma schema has already
// declared it required, so Prisma typed queries would reject the very rows being repaired.
// scripts/backfill-workspaces.ts supplies the SQL-backed adapter.

import { randomUUID } from 'crypto';

export const DEFAULT_PERSONAL_WORKSPACE_NAME = 'Personal';

export type BackfillDocumentRow = { id: string; userId: string; workspaceId: string | null; slug: string };
export type BackfillWorkspaceRow = { id: string; kind: 'PERSONAL' | 'TEAM'; ownerUserId: string | null; teamId: string | null; isDefault: boolean };
export type BackfillMemberRow = { teamId: string; userId: string };

export type BackfillClient = {
  users: () => Promise<{ id: string }[]>;
  defaultPersonalWorkspaces: () => Promise<{ id: string; ownerUserId: string | null }[]>;
  createDefaultPersonalWorkspace: (userId: string) => Promise<{ id: string; created: boolean }>;
  unassignedDocuments: () => Promise<BackfillDocumentRow[]>;
  /** Assigns a document only if it is still unassigned. Returns the number of rows written. */
  assignDocument: (documentId: string, workspaceId: string) => Promise<number>;
  allWorkspaces: () => Promise<BackfillWorkspaceRow[]>;
  allDocuments: () => Promise<BackfillDocumentRow[]>;
  activeMemberships: () => Promise<BackfillMemberRow[]>;
};

export type BackfillReport = {
  users: number;
  defaultWorkspacesCreated: number;
  documentsAssigned: number;
  documentsAlreadyAssigned: number;
  documentsWithoutDefaultWorkspace: string[];
};

export type VerifyReport = {
  users: number;
  defaultPersonalWorkspaces: number;
  documents: number;
  unassigned: number;
  misassigned: number;
  problems: string[];
};

/**
 * Creates missing default personal workspaces and assigns unassigned documents to them.
 *
 * Concurrency safety comes from the partial unique index `workspaces_owner_default_key`: two
 * simultaneous first sign-ins cannot both materialise a default workspace, and the loser reuses
 * the winner's row instead of failing.
 */
export async function applyWorkspaceBackfill(client: BackfillClient): Promise<BackfillReport> {
  const users = await client.users();
  const report: BackfillReport = {
    users: users.length,
    defaultWorkspacesCreated: 0,
    documentsAssigned: 0,
    documentsAlreadyAssigned: 0,
    documentsWithoutDefaultWorkspace: [],
  };

  const defaults = await client.defaultPersonalWorkspaces();
  const defaultByOwner = new Map(defaults.map((row) => [row.ownerUserId, row.id]));

  for (const user of users) {
    if (defaultByOwner.has(user.id)) continue;
    const workspace = await client.createDefaultPersonalWorkspace(user.id);
    defaultByOwner.set(user.id, workspace.id);
    if (workspace.created) report.defaultWorkspacesCreated++;
  }

  for (const document of await client.unassignedDocuments()) {
    const workspaceId = defaultByOwner.get(document.userId);
    if (!workspaceId) {
      report.documentsWithoutDefaultWorkspace.push(document.slug || document.id);
      continue;
    }
    // The write re-checks for NULL: a concurrent run may have assigned the row already.
    const written = await client.assignDocument(document.id, workspaceId);
    if (written > 0) report.documentsAssigned++;
    else report.documentsAlreadyAssigned++;
  }

  return report;
}

/**
 * Confirms the invariants the application relies on: exactly one default personal workspace per
 * user, and every document sitting in a workspace its author can still author in (its own
 * personal workspace, or a team workspace of a team it is still an active member of).
 */
export async function verifyWorkspaceBackfill(client: BackfillClient): Promise<VerifyReport> {
  const [users, workspaces, documents, members] = await Promise.all([
    client.users(),
    client.allWorkspaces(),
    client.allDocuments(),
    client.activeMemberships(),
  ]);

  const problems: string[] = [];
  const personalDefaults = workspaces.filter((row) => row.kind === 'PERSONAL' && row.isDefault);

  const defaultsByOwner = new Map<string, number>();
  for (const workspace of personalDefaults) {
    if (!workspace.ownerUserId) {
      problems.push('workspace ' + workspace.id + ': default personal workspace has no owner');
      continue;
    }
    defaultsByOwner.set(workspace.ownerUserId, (defaultsByOwner.get(workspace.ownerUserId) ?? 0) + 1);
  }
  for (const user of users) {
    const count = defaultsByOwner.get(user.id) ?? 0;
    if (count === 0) problems.push('user ' + user.id + ': no default personal workspace');
    if (count > 1) problems.push('user ' + user.id + ': ' + count + ' default personal workspaces');
  }

  const workspaceById = new Map(workspaces.map((row) => [row.id, row]));
  const memberships = new Set(members.map((row) => row.teamId + ' ' + row.userId));

  let unassigned = 0;
  let misassigned = 0;
  for (const document of documents) {
    const label = document.slug || document.id;
    if (!document.workspaceId) {
      unassigned++;
      problems.push('document ' + label + ': has no workspace');
      continue;
    }
    const workspace = workspaceById.get(document.workspaceId);
    if (!workspace) {
      misassigned++;
      problems.push('document ' + label + ': points at a workspace that does not exist');
      continue;
    }
    const authorCanAuthor = workspace.kind === 'PERSONAL'
      ? workspace.ownerUserId === document.userId
      : memberships.has((workspace.teamId ?? '') + ' ' + document.userId);
    if (!authorCanAuthor) {
      misassigned++;
      problems.push('document ' + label + ': author ' + document.userId + ' cannot author in workspace ' + workspace.id + ' (' + workspace.kind + ')');
    }
  }

  return {
    users: users.length,
    defaultPersonalWorkspaces: personalDefaults.length,
    documents: documents.length,
    unassigned,
    misassigned,
    problems,
  };
}

export { randomUUID };
