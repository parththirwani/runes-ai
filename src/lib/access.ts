// Server-only capability service. Every protected route calls into this module instead of
// re-implementing an ownership check, so the permission matrix in
// docs/workspaces-teams-access-plan.md has exactly one implementation.
//
// Two rules the rest of the app depends on:
//   * read intent and write intent are separate calls. A read check is never reused for a
//     mutation, and mutations re-run this module immediately before they write.
//   * an inaccessible document id or slug is a 404, never a 403, so guessing ids reveals
//     nothing about what exists.

import { NextResponse } from "next/server";
import { prisma } from "./db";
import {
  decideDocumentAccess,
  decideWorkspaceAccess,
  type DocumentCapabilities,
  type DocumentFacts,
  type GrantFact,
  type TeamMembershipFact,
  type WorkspaceCapabilities,
} from "./access-policy";
import { ensureDefaultPersonalWorkspace } from "./workspace-ownership";

export type AccessErrorCode = "not-found" | "forbidden" | "conflict";

export class AccessError extends Error {
  status: number;
  code: AccessErrorCode;

  constructor(message: string, status = 404, code: AccessErrorCode = "not-found") {
    super(message);
    this.name = "AccessError";
    this.status = status;
    this.code = code;
  }
}

/** Maps an access failure to the non-revealing response every document route returns. */
export function accessErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AccessError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return null;
}

type DbClient = typeof prisma;

export type AccessibleDocument = {
  id: string;
  slug: string;
  title: string;
  format: "LATEX" | "MARKDOWN";
  userId: string;
  workspaceId: string;
};

export type DocumentAccess = {
  document: AccessibleDocument;
  capabilities: DocumentCapabilities;
};

function toGrantFact(grant: { permission: string; acceptedAt: Date | null; revokedAt: Date | null } | null): GrantFact | null {
  if (!grant) return null;
  return {
    permission: grant.permission === "EDIT" ? "EDIT" : "VIEW",
    accepted: grant.acceptedAt !== null,
    revoked: grant.revokedAt !== null,
  };
}

async function membership(client: DbClient, teamId: string | null, userId: string | null): Promise<TeamMembershipFact | null> {
  if (!teamId || !userId) return null;
  const row = await client.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, active: true },
  });
  return row ? { role: row.role, active: row.active } : null;
}

/**
 * Loads every fact the policy needs for one (viewer, document) pair. The queries are all
 * indexed lookups; the decision itself lives in access-policy.ts.
 */
export async function loadDocumentFacts(
  client: DbClient,
  userId: string,
  document: { id: string; userId: string; workspace: { id: string; kind: string; ownerUserId: string | null; teamId: string | null } },
  options: { adminInspection?: boolean; isAdmin?: boolean } = {},
): Promise<DocumentFacts> {
  const isAdmin = options.isAdmin ?? (await isAppAdmin(client, userId));
  const teamId = document.workspace.kind === "TEAM" ? document.workspace.teamId : null;

  const [documentGrant, workspaceGrant, viewerMembership, authorMembership] = await Promise.all([
    client.documentGrant.findUnique({
      where: { documentId_recipientId: { documentId: document.id, recipientId: userId } },
      select: { permission: true, acceptedAt: true, revokedAt: true },
    }),
    client.workspaceGrant.findUnique({
      where: { workspaceId_recipientId: { workspaceId: document.workspace.id ?? "", recipientId: userId } },
      select: { permission: true, acceptedAt: true, revokedAt: true },
    }),
    membership(client, teamId, userId),
    teamId && document.userId !== userId ? membership(client, teamId, document.userId) : Promise.resolve(null),
  ]);

  return {
    viewerId: userId,
    authorId: document.userId,
    workspaceKind: document.workspace.kind === "TEAM" ? "TEAM" : "PERSONAL",
    workspaceOwnerUserId: document.workspace.ownerUserId,
    workspaceTeamId: document.workspace.teamId,
    isAdmin,
    adminInspection: options.adminInspection === true,
    documentGrant: toGrantFact(documentGrant),
    workspaceGrant: toGrantFact(workspaceGrant),
    teamMembership: viewerMembership,
    // When the viewer is the author, their own membership is the author membership.
    authorTeamMembership: teamId && document.userId !== userId ? authorMembership : viewerMembership,
  };
}

const documentSelect = {
  id: true,
  slug: true,
  title: true,
  format: true,
  userId: true,
  workspaceId: true,
  workspace: { select: { id: true, kind: true, ownerUserId: true, teamId: true } },
} as const;

type DocumentRow = AccessibleDocument & { workspace: { id: string; kind: string; ownerUserId: string | null; teamId: string | null } };

async function resolve(client: DbClient, userId: string, row: DocumentRow | null, options: { adminInspection?: boolean }): Promise<DocumentAccess | null> {
  if (!row) return null;
  const facts = await loadDocumentFacts(client, userId, row, options);
  const capabilities = decideDocumentAccess(facts);
  if (!capabilities.canRead) return null;
  const document: AccessibleDocument = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    format: row.format,
    userId: row.userId,
    workspaceId: row.workspaceId,
  };
  return { document, capabilities };
}

/** Capability check for the stable-id API surface. */
export async function getDocumentAccess(
  client: DbClient,
  userId: string,
  documentId: string,
  options: { adminInspection?: boolean } = {},
): Promise<DocumentAccess | null> {
  const row = await client.document.findUnique({ where: { id: documentId }, select: documentSelect });
  return resolve(client, userId, row as DocumentRow | null, options);
}

/**
 * Legacy slug lookup. Old author links keep working, and a shared reader can open a slug
 * only when exactly one document they can read carries it. Ambiguity is a 404 rather than
 * a guess, because an unscoped slug would otherwise resolve into another workspace.
 */
export async function getDocumentAccessBySlug(
  client: DbClient,
  userId: string,
  slug: string,
  options: { adminInspection?: boolean } = {},
): Promise<DocumentAccess | null> {
  const candidates = await client.document.findMany({
    where: { slug, ...readableWhere(userId) },
    select: documentSelect,
    take: 2,
  });
  if (candidates.length !== 1) {
    if (candidates.length > 1) {
      throw new AccessError("This document path is ambiguous; open it from the library", 409, "conflict");
    }
    return null;
  }
  return resolve(client, userId, candidates[0] as unknown as DocumentRow, options);
}

/**
 * Prisma filter selecting the documents a user might read. It is only a candidate filter:
 * every hit still goes through decideDocumentAccess before anything is returned.
 */
export function readableWhere(userId: string) {
  return {
    OR: [
      { userId },
      {
        grants: {
          some: { recipientId: userId, acceptedAt: { not: null }, revokedAt: null, permission: "VIEW" as const },
        },
      },
      {
        workspace: {
          kind: "PERSONAL" as const,
          grants: {
            some: { recipientId: userId, acceptedAt: { not: null }, revokedAt: null, permission: "VIEW" as const },
          },
        },
      },
      {
        workspace: {
          kind: "TEAM" as const,
          team: { members: { some: { userId, active: true } } },
        },
      },
    ],
  };
}

export async function requireDocumentRead(client: DbClient, userId: string, documentId: string): Promise<DocumentAccess> {
  const access = await getDocumentAccess(client, userId, documentId);
  if (!access) throw new AccessError("Document not found");
  return access;
}

export async function requireDocumentEdit(client: DbClient, userId: string, documentId: string): Promise<DocumentAccess> {
  const access = await getDocumentAccess(client, userId, documentId);
  if (!access || !access.capabilities.canEdit) throw new AccessError("Document not found");
  return access;
}

export async function requireDocumentReadBySlug(client: DbClient, userId: string, slug: string): Promise<DocumentAccess> {
  const access = await getDocumentAccessBySlug(client, userId, slug);
  if (!access) throw new AccessError("Document not found");
  return access;
}

export async function requireDocumentEditBySlug(client: DbClient, userId: string, slug: string): Promise<DocumentAccess> {
  const access = await getDocumentAccessBySlug(client, userId, slug);
  if (!access || !access.capabilities.canEdit) throw new AccessError("Document not found");
  return access;
}

export async function isAppAdmin(client: DbClient, userId: string): Promise<boolean> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return Boolean(user?.isAdmin);
}

/** App-admin guard for /api/admin/* and /admin. Never infers this from an email domain. */
export async function requireAppAdmin(client: DbClient, userId: string): Promise<void> {
  if (!(await isAppAdmin(client, userId))) throw new AccessError("Not found", 404);
}

export type WorkspaceAccess = {
  workspace: { id: string; name: string; kind: "PERSONAL" | "TEAM"; ownerUserId: string | null; teamId: string | null; isDefault: boolean };
  capabilities: WorkspaceCapabilities;
};

const workspaceSelect = {
  id: true,
  name: true,
  kind: true,
  ownerUserId: true,
  teamId: true,
  isDefault: true,
} as const;

type WorkspaceRow = {
  id: string;
  name: string;
  kind: string;
  ownerUserId: string | null;
  teamId: string | null;
  isDefault: boolean;
};

export async function getWorkspaceAccess(
  client: DbClient,
  userId: string,
  workspaceId: string,
  options: { adminInspection?: boolean } = {},
): Promise<WorkspaceAccess | null> {
  const row = await client.workspace.findUnique({ where: { id: workspaceId }, select: workspaceSelect });
  if (!row) return null;
  return resolveWorkspace(client, userId, row, options);
}

async function resolveWorkspace(
  client: DbClient,
  userId: string,
  row: WorkspaceRow,
  options: { adminInspection?: boolean },
): Promise<WorkspaceAccess | null> {
  const kind = row.kind === "TEAM" ? "TEAM" : "PERSONAL";
  const [isAdmin, grant, teamMembership] = await Promise.all([
    isAppAdmin(client, userId),
    client.workspaceGrant.findUnique({
      where: { workspaceId_recipientId: { workspaceId: row.id, recipientId: userId } },
      select: { permission: true, acceptedAt: true, revokedAt: true },
    }),
    kind === "TEAM" ? membership(client, row.teamId, userId) : Promise.resolve(null),
  ]);

  const capabilities = decideWorkspaceAccess({
    viewerId: userId,
    kind,
    ownerUserId: row.ownerUserId,
    teamId: row.teamId,
    isAdmin,
    grant: toGrantFact(grant),
    teamMembership,
  });
  if (!capabilities) return null;
  if (capabilities.access === "admin-inspection" && options.adminInspection !== true) return null;

  return {
    workspace: {
      id: row.id,
      name: row.name,
      kind,
      ownerUserId: row.ownerUserId,
      teamId: row.teamId,
      isDefault: row.isDefault,
    },
    capabilities,
  };
}

export async function requireWorkspaceRead(client: DbClient, userId: string, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(client, userId, workspaceId);
  if (!access || !access.capabilities.canRead) throw new AccessError("Workspace not found");
  return access;
}

export async function requireWorkspaceCreate(client: DbClient, userId: string, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(client, userId, workspaceId);
  if (!access || !access.capabilities.canCreate) throw new AccessError("Workspace not found");
  return access;
}

/**
 * Every workspace the user may list documents in, in a stable order: own personal
 * workspaces first (default first), then accepted shares, then team workspaces.
 */
export async function listAccessibleWorkspaces(client: DbClient, userId: string): Promise<WorkspaceAccess[]> {
  const [owned, granted, memberships] = await Promise.all([
    client.workspace.findMany({
      where: { ownerUserId: userId },
      select: workspaceSelect,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    client.workspaceGrant.findMany({
      where: { recipientId: userId, acceptedAt: { not: null }, revokedAt: null, permission: "VIEW" },
      select: { workspace: { select: workspaceSelect } },
      orderBy: { createdAt: "asc" },
    }),
    client.teamMember.findMany({
      where: { userId, active: true },
      select: { team: { select: { workspaces: { where: { isDefault: true, kind: "TEAM" }, select: workspaceSelect } } } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);

  const rows: WorkspaceRow[] = [
    ...owned,
    ...granted.map((row) => row.workspace),
    ...memberships.flatMap((row) => row.team.workspaces),
  ];

  const seen = new Set<string>();
  const result: WorkspaceAccess[] = [];
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    const access = await resolveWorkspace(client, userId, row, { adminInspection: false });
    if (access) result.push(access);
  }
  return result;
}

/**
 * Documents the user can read inside one workspace they can read. Returns capability flags
 * per document so the library can show View or Edit without a second round trip.
 */
export async function listWorkspaceDocuments(client: DbClient, userId: string, workspaceId: string) {
  await requireWorkspaceRead(client, userId, workspaceId);
  const rows = await client.document.findMany({
    where: { workspaceId },
    select: {
      id: true,
      slug: true,
      title: true,
      format: true,
      isFavorite: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      workspaceId: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const capabilities = await capabilitiesForMany(client, userId, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, capabilities: capabilities.get(row.id) ?? null })).filter((row) => row.capabilities !== null);
}

/**
 * Batched capability lookup for list endpoints. Falls back to the single-document loader
 * for anything the batch could not resolve, so the two paths can never disagree in the
 * permissive direction.
 */
export async function capabilitiesForMany(
  client: DbClient,
  userId: string,
  documentIds: string[],
): Promise<Map<string, DocumentCapabilities>> {
  const result = new Map<string, DocumentCapabilities>();
  if (documentIds.length === 0) return result;

  const [isAdmin, documents, documentGrants, workspaceGrants, teamMemberships] = await Promise.all([
    isAppAdmin(client, userId),
    client.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, userId: true, workspace: { select: { id: true, kind: true, ownerUserId: true, teamId: true } } },
    }),
    client.documentGrant.findMany({
      where: { recipientId: userId, documentId: { in: documentIds } },
      select: { documentId: true, permission: true, acceptedAt: true, revokedAt: true },
    }),
    client.workspaceGrant.findMany({
      where: { recipientId: userId },
      select: { workspaceId: true, permission: true, acceptedAt: true, revokedAt: true },
    }),
    client.teamMember.findMany({
      where: { userId },
      select: { teamId: true, role: true, active: true },
    }),
  ]);

  const grantsByDocument = new Map(documentGrants.map((row) => [row.documentId, row]));
  const grantsByWorkspace = new Map(workspaceGrants.map((row) => [row.workspaceId, row]));
  const memberships = new Map(teamMemberships.map((row) => [row.teamId, { role: row.role, active: row.active }]));

  for (const document of documents) {
    const teamId = document.workspace.kind === "TEAM" ? document.workspace.teamId : null;
    const capabilities = decideDocumentAccess({
      viewerId: userId,
      authorId: document.userId,
      workspaceKind: document.workspace.kind === "TEAM" ? "TEAM" : "PERSONAL",
      workspaceOwnerUserId: document.workspace.ownerUserId,
      workspaceTeamId: document.workspace.teamId,
      isAdmin,
      adminInspection: false,
      documentGrant: toGrantFact(grantsByDocument.get(document.id) ?? null),
      workspaceGrant: toGrantFact(grantsByWorkspace.get(document.workspace.id) ?? null),
      teamMembership: teamId ? memberships.get(teamId) ?? null : null,
      authorTeamMembership: teamId && document.userId !== userId ? null : teamId ? memberships.get(teamId) ?? null : null,
    });
    if (capabilities.canRead) result.set(document.id, capabilities);
  }

  return result;
}

export { ensureDefaultPersonalWorkspace };

/**
 * Author-only check for the endpoints that stay with the document's author in v1: AI
 * completion, paraphrase, and chat. Those calls spend quota and may send source to a
 * provider, so a reader is never allowed to trigger them.
 *
 * This is the same capability question as everything else here, expressed for the author-only
 * case, so no route writes its own ownership comparison.
 */
export async function findAuthorOnlyDocument<Client extends DbClient, TSelect extends object>(
  client: Client,
  userId: string,
  documentId: string,
  select: TSelect,
) {
  return client.document.findFirst({ where: { id: documentId, userId }, select });
}
