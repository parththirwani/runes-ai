// Collection-workspace service: default workspace provisioning, listing, creation and moves.
//
// Every function here is server-only and takes the acting user id. Nothing trusts a workspace id
// that arrived from a client without checking it through src/lib/access.ts first.

import { prisma } from './db';
import { generateSlug } from './slug';
import { latexTemplate, markdownTemplate } from './templates';
import { getWorkspaceAccess, listReadableDocumentsInWorkspace, writableDocument, type AccessClient, type AccessWorkspace } from './access';
import { DEFAULT_PERSONAL_WORKSPACE_NAME } from './workspaces-backfill';

export class WorkspaceInputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkspaceInputError';
    this.status = status;
  }
}

const MAX_WORKSPACE_NAME_CHARS = 60;

export function normalizeWorkspaceName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (name.length === 0) throw new WorkspaceInputError('Workspace name is required');
  if (name.length > MAX_WORKSPACE_NAME_CHARS) throw new WorkspaceInputError('Workspace name is longer than ' + MAX_WORKSPACE_NAME_CHARS + ' characters');
  return name;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

/**
 * Returns the user's default personal workspace, creating it on first use.
 *
 * Called from the sign-in path, so it has to survive two concurrent first requests: the partial
 * unique index `workspaces_owner_default_key` lets exactly one insert win, and the loser reads
 * the winner's row instead of failing.
 */
export async function ensureDefaultPersonalWorkspace(userId: string): Promise<{ id: string; name: string }> {
  const existing = await prisma.workspace.findFirst({ where: { ownerUserId: userId, kind: 'PERSONAL', isDefault: true } });
  if (existing) return { id: existing.id, name: existing.name };

  try {
    const created = await prisma.workspace.create({
      data: { name: DEFAULT_PERSONAL_WORKSPACE_NAME, kind: 'PERSONAL', ownerUserId: userId, isDefault: true },
    });
    return { id: created.id, name: created.name };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.workspace.findFirst({ where: { ownerUserId: userId, kind: 'PERSONAL', isDefault: true } });
    if (!raced) throw error;
    return { id: raced.id, name: raced.name };
  }
}

export type WorkspaceListItem = {
  id: string;
  name: string;
  kind: 'PERSONAL' | 'TEAM';
  isDefault: boolean;
  teamId: string | null;
  teamName: string | null;
  documentCount: number;
  access: 'owner' | 'member' | 'viewer';
  canCreate: boolean;
  canShare: boolean;
  canRename: boolean;
  canManageTeam: boolean;
};

/**
 * Everything the workspace switcher should show: the user's own personal workspaces, the default
 * workspace of every team they are still an active member of, and personal workspaces shared with
 * them. A removed member or revoked recipient disappears because this list is derived from
 * current rows on every call.
 */
export async function listAccessibleWorkspaces(userId: string): Promise<WorkspaceListItem[]> {
  const owned = await prisma.workspace.findMany({
    where: { kind: 'PERSONAL', ownerUserId: userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  const shared = await prisma.workspaceGrant.findMany({
    where: { recipientUserId: userId, acceptedAt: { not: null }, revokedAt: null, permission: 'VIEW' },
    include: { workspace: { include: { _count: { select: { documents: true } } } } },
    orderBy: { acceptedAt: 'asc' },
  });
  const memberships = await prisma.teamMember.findMany({
    where: { userId, active: true },
    include: { team: { include: { workspaces: { where: { kind: 'TEAM', isDefault: true }, include: { _count: { select: { documents: true } } } } } } },
    orderBy: { joinedAt: 'asc' },
  });

  const items: WorkspaceListItem[] = [];
  for (const workspace of owned) {
    items.push({
      id: workspace.id,
      name: workspace.name,
      kind: 'PERSONAL',
      isDefault: workspace.isDefault,
      teamId: null,
      teamName: null,
      documentCount: await prisma.document.count({ where: { workspaceId: workspace.id } }),
      access: 'owner',
      canCreate: true,
      canShare: true,
      canRename: true,
      canManageTeam: false,
    });
  }
  for (const membership of memberships) {
    for (const workspace of membership.team.workspaces) {
      items.push({
        id: workspace.id,
        name: membership.team.name,
        kind: 'TEAM',
        isDefault: workspace.isDefault,
        teamId: membership.teamId,
        teamName: membership.team.name,
        documentCount: workspace._count.documents,
        access: 'member',
        canCreate: true,
        canShare: false,
        canRename: membership.role === 'ADMIN',
        canManageTeam: membership.role === 'ADMIN',
      });
    }
  }
  for (const grant of shared) {
    items.push({
      id: grant.workspace.id,
      name: grant.workspace.name,
      kind: 'PERSONAL',
      isDefault: grant.workspace.isDefault,
      teamId: null,
      teamName: null,
      documentCount: grant.workspace._count.documents,
      access: 'viewer',
      canCreate: false,
      canShare: false,
      canRename: false,
      canManageTeam: false,
    });
  }
  return items;
}

/** Loads a workspace only when the caller can read it, so routes can answer a flat 404. */
export async function readableWorkspace(userId: string, workspaceId: string) {
  return getWorkspaceAccess(userId, workspaceId);
}

export async function createPersonalWorkspace(userId: string, rawName: string) {
  const name = normalizeWorkspaceName(rawName);
  // Provisioning the default first keeps older accounts with no workspace from ending up with a
  // single non-default workspace, which the partial unique index would then refuse to repair.
  await ensureDefaultPersonalWorkspace(userId);
  try {
    return await prisma.workspace.create({ data: { name, kind: 'PERSONAL', ownerUserId: userId, isDefault: false } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new WorkspaceInputError('You already have a workspace named ' + name, 409);
    throw error;
  }
}

export async function renameWorkspace(userId: string, workspaceId: string, rawName: string) {
  const name = normalizeWorkspaceName(rawName);
  const access = await getWorkspaceAccess(userId, workspaceId);
  if (!access || !access.capabilities.canRename) return null;
  try {
    return await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new WorkspaceInputError('Another workspace is already named ' + name, 409);
    throw error;
  }
}

/**
 * Documents the caller can see inside one workspace, with the author and the caller's own
 * access level. Search and filters are applied on top of this scope only, never across scopes.
 */
export async function listWorkspaceDocuments(userId: string, workspaceId: string) {
  const access = await getWorkspaceAccess(userId, workspaceId);
  if (!access) return null;
  const rows = await listReadableDocumentsInWorkspace(userId, access.workspace as AccessWorkspace);
  return {
    workspace: access.workspace,
    capabilities: access.capabilities,
    teamRole: access.teamRole,
    documents: rows.map((row) => ({
      id: row.document.id,
      title: row.document.title,
      slug: row.document.slug,
      format: row.document.format,
      mainFilePath: row.document.mainFilePath,
      createdAt: row.document.createdAt,
      updatedAt: row.document.updatedAt,
      authorName: row.authorName,
      isAuthor: row.document.userId === userId,
      access: row.canEdit ? ('Edit' as const) : ('View' as const),
    })),
  };
}

function slugFromTitle(title: string): string {
  const slug = generateSlug(title);
  return slug.length > 0 ? slug : 'document';
}

/**
 * Finds a free (workspaceId, slug) pair. Uniqueness is scoped to the workspace, so two workspaces
 * may legitimately expose the same URL segment; inside one workspace a suffix keeps them apart.
 */
async function uniqueSlugInWorkspace(workspaceId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugFromTitle(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : base + '-' + (attempt + 1);
    const clash = await prisma.document.findFirst({
      where: { workspaceId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new WorkspaceInputError('Could not derive a unique URL for this title', 409);
}

export type CreateDocumentInput = {
  userId: string;
  workspaceId: string;
  title: string;
  format: 'LATEX' | 'MARKDOWN';
  content?: string;
};

/** Creates a document in a workspace the caller may author in. Viewers never reach this. */
export async function createDocumentInWorkspace(input: CreateDocumentInput) {
  const access = await getWorkspaceAccess(input.userId, input.workspaceId);
  if (!access || !access.capabilities.canCreate) {
    throw new WorkspaceInputError(access ? 'You have view access to this workspace' : 'Workspace not found', access ? 403 : 404);
  }
  const title = input.title.trim();
  if (title.length === 0) throw new WorkspaceInputError('Title is required');

  const duplicateTitle = await prisma.document.findFirst({ where: { workspaceId: input.workspaceId, title }, select: { id: true } });
  if (duplicateTitle) throw new WorkspaceInputError('This workspace already has a document named ' + title, 409);

  const slug = await uniqueSlugInWorkspace(input.workspaceId, title);
  const source = input.content ?? (input.format === 'MARKDOWN' ? markdownTemplate(title) : latexTemplate(title));
  const mainFilePath = input.format === 'MARKDOWN' ? 'main.md' : 'main.tex';

  try {
    return await prisma.document.create({
      data: {
        title,
        slug,
        format: input.format,
        mainFilePath,
        content: source,
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new WorkspaceInputError('This workspace already has a document named ' + title, 409);
    throw error;
  }
}

export type MoveImpact = {
  gainsTeamVisibility: string[];
  losesTeamVisibility: string[];
  keepsDirectShares: number;
};

/**
 * Shows the sharing consequences of a move before the caller confirms it. A move into a team
 * workspace exposes the document to every member; moving it out removes that inherited access.
 * Direct document shares stay attached to the document either way.
 */
export async function describeMoveImpact(documentId: string, toWorkspaceId: string): Promise<MoveImpact | null> {
  const document = await prisma.document.findUnique({ where: { id: documentId }, select: { workspaceId: true } });
  if (!document) return null;
  const [from, to, directShares] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: document.workspaceId }, include: { team: { include: { members: { where: { active: true } } } } } }),
    prisma.workspace.findUnique({ where: { id: toWorkspaceId }, include: { team: { include: { members: { where: { active: true } } } } } }),
    prisma.documentGrant.count({ where: { documentId, revokedAt: null } }),
  ]);
  const teamEmails = (workspace: typeof to) => (workspace?.kind === 'TEAM' ? (workspace.team?.members ?? []).map((member) => member.userId) : []);
  return { gainsTeamVisibility: teamEmails(to), losesTeamVisibility: teamEmails(from), keepsDirectShares: directShares };
}

/**
 * Author-only move between workspaces the author may author in. Runs in a transaction that
 * re-checks both the collision and the destination permission immediately before the write.
 */
export async function moveDocument(input: { userId: string; documentId: string; toWorkspaceId: string }) {
  const destination = await getWorkspaceAccess(input.userId, input.toWorkspaceId);
  if (!destination || !destination.capabilities.canCreate) {
    throw new WorkspaceInputError(destination ? 'You cannot add documents to that workspace' : 'Workspace not found', destination ? 403 : 404);
  }
  const document = await prisma.document.findUnique({ where: { id: input.documentId } });
  if (!document) throw new WorkspaceInputError('Document not found', 404);
  if (document.userId !== input.userId) throw new WorkspaceInputError('Only the author can move this document', 403);
  if (!await writableDocument(input.userId, document.id)) {
    throw new WorkspaceInputError('You can no longer move this document', 403);
  }
  if (document.workspaceId === input.toWorkspaceId) {
    return { document, unchanged: true as const };
  }

  const clash = await prisma.document.findFirst({
    where: { workspaceId: input.toWorkspaceId, OR: [{ title: document.title }, { slug: document.slug }] },
    select: { title: true, slug: true },
  });
  if (clash) {
    throw new WorkspaceInputError(
      clash.title === document.title
        ? 'The destination workspace already has a document named ' + document.title
        : 'The destination workspace already uses the URL /' + document.slug,
      409,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Re-read source and destination access through the transaction so a revoked team member
    // cannot move a document they authored out of the team workspace.
    const source = await writableDocument(input.userId, document.id, tx as unknown as AccessClient);
    if (!source) throw new WorkspaceInputError('You can no longer move this document', 403);
    const stillAllowed = await getWorkspaceAccess(input.userId, input.toWorkspaceId, tx as unknown as AccessClient);
    if (!stillAllowed || !stillAllowed.capabilities.canCreate) {
      throw new WorkspaceInputError('You can no longer add documents to that workspace', 403);
    }
    return tx.document.update({ where: { id: document.id }, data: { workspaceId: input.toWorkspaceId } });
  });
  return { document: updated, unchanged: false as const };
}

export { uniqueSlugInWorkspace };
