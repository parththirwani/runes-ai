// Server-only authorization service for collection workspaces and documents.
//
// This is the single place that decides what a user may do. Routes never compare `userId`
// themselves, so adding an `EDIT` grant later means changing this file plus the routes that must
// refuse it, not auditing every query in the app again.
//
// Two rules hold everywhere and are the reason the checks below look repetitive:
//   1. Editing follows the author. No grant, team role or admin flag turns a reader into a writer.
//   2. Reading is re-derived from current membership on every request. Revoking a share or
//      removing a team member takes effect on the next request, including file and asset reads.

import { prisma } from './db';

export type AccessSource =
  | 'author'
  | 'document-grant'
  | 'workspace-grant'
  | 'team-member'
  | 'app-admin'
  | null;

export type DocumentCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canShare: boolean;
  canManageTeam: boolean;
  source: AccessSource;
};

export type WorkspaceCapabilities = DocumentCapabilities & { canRename: boolean };

export type AccessWorkspace = {
  id: string;
  name: string;
  kind: 'PERSONAL' | 'TEAM';
  ownerUserId: string | null;
  teamId: string | null;
  isDefault: boolean;
};

export type AccessDocument = {
  id: string;
  title: string;
  slug: string;
  format: 'LATEX' | 'MARKDOWN';
  mainFilePath: string;
  content: string | null;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentAccess = {
  document: AccessDocument;
  workspace: AccessWorkspace;
  author: { id: string; email: string; name: string } | null;
  capabilities: DocumentCapabilities;
};

export type WorkspaceAccess = {
  workspace: AccessWorkspace;
  capabilities: WorkspaceCapabilities;
  teamId: string | null;
  teamRole: 'ADMIN' | 'MEMBER' | null;
};

type MembershipRow = { role: 'ADMIN' | 'MEMBER'; active: boolean } | null;
type GrantRow = { permission: 'VIEW' | 'EDIT'; acceptedAt: Date | null; revokedAt: Date | null } | null;

export type AccessClient = {
  user: {
    findUnique: (input: { where: { id: string } }) => Promise<{ id: string; email: string; firstName: string | null; lastName: string | null; isAdmin: boolean } | null>;
  };
  document: {
    findUnique: (input: { where: { id: string } }) => Promise<(AccessDocument & { workspace?: AccessWorkspace | null }) | null>;
    findMany: (input: unknown) => Promise<(AccessDocument & { user?: { id: string; email: string; firstName: string | null; lastName: string | null } | null })[]>;
  };
  workspace: {
    findUnique: (input: { where: { id: string } }) => Promise<(AccessWorkspace & { team?: { id: string; name: string } | null }) | null>;
  };
  teamMember: {
    findFirst: (input: { where: Record<string, unknown> }) => Promise<MembershipRow>;
  };
  workspaceGrant: {
    findFirst: (input: { where: Record<string, unknown> }) => Promise<GrantRow>;
  };
  documentGrant: {
    findFirst: (input: { where: Record<string, unknown> }) => Promise<GrantRow>;
  };
};

const DENY: DocumentCapabilities = { canRead: false, canCreate: false, canEdit: false, canShare: false, canManageTeam: false, source: null };

/** A grant only counts once the recipient accepted it and before it is revoked. */
function isActiveGrant(grant: GrantRow): boolean {
  if (!grant) return false;
  // EDIT is reserved in the enum for a later release; nothing may honour it yet.
  if (grant.permission !== 'VIEW') return false;
  return grant.acceptedAt !== null && grant.revokedAt === null;
}

function displayName(user: { firstName: string | null; lastName: string | null; email: string } | null): string {
  if (!user) return 'Unknown author';
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return full.length > 0 ? full : user.email;
}

async function activeMembership(client: AccessClient, teamId: string, userId: string): Promise<MembershipRow> {
  const row = await client.teamMember.findFirst({ where: { teamId, userId, active: true } });
  if (!row || !row.active) return null;
  return row;
}

/**
 * Resolves what `userId` may do inside a workspace.
 *
 * A personal workspace is private to its owner, plus accepted recipients of a workspace share.
 * A team workspace is open to every active member, and its admins additionally manage members.
 */
export async function getWorkspaceAccess(
  userId: string,
  workspaceId: string,
  client: AccessClient = prisma as unknown as AccessClient,
): Promise<WorkspaceAccess | null> {
  const workspace = await client.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return null;

  const isOwner = workspace.kind === 'PERSONAL' && workspace.ownerUserId === userId;
  if (isOwner) {
    return {
      workspace,
      teamId: null,
      teamRole: null,
      capabilities: { canRead: true, canCreate: true, canEdit: true, canShare: true, canManageTeam: false, canRename: true, source: 'author' },
    };
  }

  if (workspace.kind === 'TEAM' && workspace.teamId) {
    const membership = await activeMembership(client, workspace.teamId, userId);
    if (membership) {
      const admin = membership.role === 'ADMIN';
      return {
        workspace,
        teamId: workspace.teamId,
        teamRole: membership.role,
        capabilities: {
          canRead: true,
          canCreate: true,
          canEdit: false, // set per document: only the author may edit
          canShare: false,
          canManageTeam: admin,
          canRename: admin,
          source: 'team-member',
        },
      };
    }
    return null;
  }

  const grant = await client.workspaceGrant.findFirst({ where: { workspaceId, recipientUserId: userId } });
  if (isActiveGrant(grant)) {
    return {
      workspace,
      teamId: null,
      teamRole: null,
      capabilities: { canRead: true, canCreate: false, canEdit: false, canShare: false, canManageTeam: false, canRename: false, source: 'workspace-grant' },
    };
  }

  return null;
}

/** Convenience wrapper for callers that only need the capability flags. */
export async function getWorkspaceCapabilities(
  userId: string,
  workspaceId: string,
  client: AccessClient = prisma as unknown as AccessClient,
): Promise<WorkspaceCapabilities | null> {
  const access = await getWorkspaceAccess(userId, workspaceId, client);
  return access ? access.capabilities : null;
}

/**
 * Resolves read and edit rights for one document.
 *
 * Returns null for unknown ids and for documents the user may not read, which lets every route
 * answer with the same non-revealing 404 instead of leaking that the document exists.
 */
export async function getDocumentAccess(
  userId: string,
  documentId: string,
  client: AccessClient = prisma as unknown as AccessClient,
): Promise<DocumentAccess | null> {
  const row = await client.document.findUnique({ where: { id: documentId } });
  if (!row) return null;

  const { workspace: maybeWorkspace, ...document } = row;
  const workspace: AccessWorkspace | null = maybeWorkspace ?? await client.workspace.findUnique({ where: { id: document.workspaceId } });
  if (!workspace) return null;

  const author = document.userId === userId
    ? { id: userId, email: '', name: 'You' }
    : null;

  const isAuthor = document.userId === userId;
  if (isAuthor) {
    // The author keeps edit rights only while they may still author in the containing workspace.
    // A removed team member keeps attribution but loses both read and write through the team.
    const workspaceAccess = await getWorkspaceAccess(userId, workspace.id, client);
    if (!workspaceAccess || !workspaceAccess.capabilities.canCreate) return null;
    const authorUser = await client.user.findUnique({ where: { id: userId } });
    return {
      document,
      workspace,
      author: { id: userId, email: authorUser?.email ?? '', name: displayName(authorUser) },
      capabilities: {
        canRead: true,
        canCreate: true,
        canEdit: true,
        canShare: true,
        canManageTeam: workspaceAccess.capabilities.canManageTeam,
        source: 'author',
      },
    };
  }

  const authorRow = await client.user.findUnique({ where: { id: document.userId } });
  const authorProfile = authorRow ? { id: authorRow.id, email: authorRow.email, name: displayName(authorRow) } : null;

  // Direct document share: exactly this document, and it survives a workspace move.
  const documentGrant = await client.documentGrant.findFirst({ where: { documentId: document.id, recipientUserId: userId } });
  if (isActiveGrant(documentGrant)) {
    return { document, workspace, author: authorProfile, capabilities: { ...DENY, canRead: true, source: 'document-grant' } };
  }

  if (workspace.kind === 'PERSONAL') {
    // Personal workspace share: current and future documents in that workspace.
    const grant = await client.workspaceGrant.findFirst({ where: { workspaceId: workspace.id, recipientUserId: userId } });
    if (isActiveGrant(grant)) {
      return { document, workspace, author: authorProfile, capabilities: { ...DENY, canRead: true, source: 'workspace-grant' } };
    }
    return null;
  }

  if (workspace.kind === 'TEAM' && workspace.teamId) {
    const membership = await activeMembership(client, workspace.teamId, userId);
    if (!membership) return null;
    return {
      document,
      workspace,
      author: authorProfile,
      capabilities: {
        canRead: true,
        canCreate: true,
        canEdit: false,
        canShare: false,
        canManageTeam: membership.role === 'ADMIN',
        source: 'team-member',
      },
    };
  }

  return null;
}

export async function getDocumentCapabilities(
  userId: string,
  documentId: string,
  client: AccessClient = prisma as unknown as AccessClient,
): Promise<DocumentCapabilities | null> {
  const access = await getDocumentAccess(userId, documentId, client);
  return access ? access.capabilities : null;
}

/**
 * Read-intent lookup for routes. Never use this to authorize a write: `canEdit` must be checked
 * explicitly so a future change to the read rules cannot widen a mutation path.
 */
export async function readableDocument(userId: string, documentId: string, client: AccessClient = prisma as unknown as AccessClient) {
  const access = await getDocumentAccess(userId, documentId, client);
  if (!access || !access.capabilities.canRead) return null;
  return access;
}

/** Write-intent lookup for routes: the author only, re-derived at mutation time. */
export async function writableDocument(userId: string, documentId: string, client: AccessClient = prisma as unknown as AccessClient) {
  const access = await getDocumentAccess(userId, documentId, client);
  if (!access || !access.capabilities.canEdit) return null;
  return access;
}

/** App-admin inspection: read-only, never an author substitute, and always audited by the caller. */
export async function getAppAdminUser(userId: string, client: AccessClient = prisma as unknown as AccessClient) {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user || !user.isAdmin) return null;
  return user;
}

/**
 * Workspace-scoped document listing. Returns the documents the user can read in one workspace,
 * with the author and the caller's own access level so the library can label every row.
 */
export async function listReadableDocumentsInWorkspace(
  userId: string,
  workspace: AccessWorkspace,
  client: AccessClient = prisma as unknown as AccessClient,
) {
  const access = await getWorkspaceAccess(userId, workspace.id, client);
  if (!access || !access.capabilities.canRead) return [];
  const documents = await client.document.findMany({
    where: { workspaceId: workspace.id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return documents.map((document) => ({
    document,
    authorName: document.user ? displayName(document.user) : 'Unknown author',
    canEdit: document.userId === userId && access.capabilities.canCreate,
  }));
}
