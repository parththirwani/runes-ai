// App-admin dashboard queries.
//
// Every function here starts from getAppAdminUser, which reads the stored flag and nothing else,
// so a route cannot accidentally expose these to a signed-in user. Listing endpoints return
// metadata only; opening document content is a separate explicit call that writes an audit row.

import { prisma } from './db';
import { getAppAdminUser } from './access';
import { recordAuditEvent } from './audit';
import { plainTextExcerpt } from './excerpt';

export const ADMIN_PAGE_SIZE = 20;
export const ADMIN_MAX_PAGE_SIZE = 100;

export class AdminError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
  }
}

export async function requireAppAdmin(userId: string) {
  const user = await getAppAdminUser(userId);
  if (!user) throw new AdminError('Administrator access is required', 403);
  return user;
}

function pageBounds(page: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize, 1), ADMIN_MAX_PAGE_SIZE);
  const index = Math.max(page, 1);
  return { take: size, skip: (index - 1) * size, pageSize: size, pageIndex: index };
}

export async function adminListTeams(input: { actorUserId: string; page?: number; pageSize?: number }) {
  await requireAppAdmin(input.actorUserId);
  const { take, skip, pageSize, pageIndex } = pageBounds(input.page ?? 1, input.pageSize ?? ADMIN_PAGE_SIZE);

  const [teams, total] = await Promise.all([
    prisma.team.findMany({
      include: {
        _count: { select: { members: true, invitations: true } },
        workspaces: { where: { kind: 'TEAM', isDefault: true }, select: { id: true, name: true, _count: { select: { documents: true } } } },
        createdBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.team.count(),
  ]);

  return {
    page: pageIndex,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      createdAt: team.createdAt,
      archivedAt: team.archivedAt,
      createdBy: team.createdBy?.email ?? null,
      memberCount: team._count.members,
      invitationCount: team._count.invitations,
      workspace: team.workspaces[0] ? { id: team.workspaces[0].id, name: team.workspaces[0].name, documentCount: team.workspaces[0]._count.documents } : null,
    })),
  };
}

/** Team detail for the dashboard: members, documents with authors, and invitations. Metadata only. */
export async function adminTeamDetail(input: { actorUserId: string; teamId: string; page?: number; pageSize?: number }) {
  await requireAppAdmin(input.actorUserId);
  const team = await prisma.team.findUnique({
    where: { id: input.teamId },
    include: {
      createdBy: { select: { email: true } },
      workspaces: { where: { kind: 'TEAM' }, select: { id: true, name: true, isDefault: true } },
    },
  });
  if (!team) throw new AdminError('Team not found', 404);
  const { take, skip, pageSize, pageIndex } = pageBounds(input.page ?? 1, input.pageSize ?? ADMIN_PAGE_SIZE);

  const workspaceIds = team.workspaces.map((workspace) => workspace.id);
  const [members, documents, documentTotal, invitations] = await Promise.all([
    listTeamRoster(team.id),
    prisma.document.findMany({
      where: { workspaceId: { in: workspaceIds } },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { updatedAt: 'desc' },
      take,
      skip,
    }),
    prisma.document.count({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.invitation.findMany({ where: { teamId: team.id }, include: { inviter: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  return {
    team: { id: team.id, name: team.name, createdAt: team.createdAt, archivedAt: team.archivedAt, createdBy: team.createdBy?.email ?? null },
    workspaces: team.workspaces,
    members,
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.targetEmail,
      status: invitation.expiresAt.getTime() <= Date.now() && invitation.status === 'PENDING' ? 'EXPIRED' : invitation.status,
      invitedBy: invitation.inviter.email,
      expiresAt: invitation.expiresAt,
    })),
    documents: {
      page: pageIndex,
      pageSize,
      total: documentTotal,
      totalPages: Math.max(1, Math.ceil(documentTotal / pageSize)),
      rows: documents.map((document) => ({
        id: document.id,
        title: document.title,
        format: document.format,
        workspaceId: document.workspaceId,
        updatedAt: document.updatedAt,
        author: {
          id: document.user.id,
          email: document.user.email,
          name: `${document.user.firstName ?? ''} ${document.user.lastName ?? ''}`.trim() || document.user.email,
        },
      })),
    },
  };
}

async function listTeamRoster(teamId: string) {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    email: membership.user.email,
    name: `${membership.user.firstName ?? ''} ${membership.user.lastName ?? ''}`.trim() || membership.user.email,
    role: membership.role,
    active: membership.active,
    joinedAt: membership.joinedAt,
    removedAt: membership.removedAt,
  }));
}

/**
 * Explicit, audited content inspection. It grants no edit right and no share right; the caller
 * still cannot save, and the audit row records exactly who looked at what.
 */
export async function adminInspectDocument(input: { actorUserId: string; documentId: string }) {
  await requireAppAdmin(input.actorUserId);
  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      workspace: { select: { id: true, name: true, kind: true, teamId: true } },
    },
  });
  if (!document) throw new AdminError('Document not found', 404);

  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: 'document.inspect',
    teamId: document.workspace.teamId,
    workspaceId: document.workspace.id,
    documentId: document.id,
    targetUserId: document.userId,
  });

  const source = await prisma.workspaceFile.findFirst({
    where: { documentId: document.id, path: document.mainFilePath },
    select: { content: true },
  });
  const content = source?.content ?? document.content ?? '';
  return {
    document: {
      id: document.id,
      title: document.title,
      format: document.format,
      updatedAt: document.updatedAt,
      workspace: document.workspace,
      author: {
        id: document.user.id,
        email: document.user.email,
        name: `${document.user.firstName ?? ''} ${document.user.lastName ?? ''}`.trim() || document.user.email,
      },
      // Read-only projection: the raw source plus the same derived excerpt the library uses.
      source: content,
      excerpt: plainTextExcerpt(content, document.format === 'MARKDOWN' ? 'MARKDOWN' : 'LATEX'),
      readOnly: true,
    },
  };
}

export async function adminCrossTeamDocuments(input: { actorUserId: string; search?: string; page?: number; pageSize?: number }) {
  await requireAppAdmin(input.actorUserId);
  const { take, skip, pageSize, pageIndex } = pageBounds(input.page ?? 1, input.pageSize ?? ADMIN_PAGE_SIZE);
  const search = (input.search ?? '').trim();
  const where = search.length > 0
    ? { title: { contains: search, mode: 'insensitive' as const } }
    : undefined;

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { user: { select: { email: true } }, workspace: { select: { id: true, name: true, kind: true, team: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take,
      skip,
    }),
    prisma.document.count({ where }),
  ]);

  return {
    page: pageIndex,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((document) => ({
      id: document.id,
      title: document.title,
      format: document.format,
      updatedAt: document.updatedAt,
      authorEmail: document.user.email,
      workspace: document.workspace.name,
      team: document.workspace.team?.name ?? null,
    })),
  };
}
