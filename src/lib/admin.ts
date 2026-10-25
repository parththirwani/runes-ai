// App-admin read paths and their audit events.
//
// Every function here starts by requiring the app-admin flag on the database user; nothing
// is inferred from an email domain or a client claim. Document listings expose metadata only.
// Reading document *content* is a separate, explicitly audited action.

import { prisma } from "./db";
import { AccessError, requireAppAdmin } from "./access";
import { AuditAction, recordAuditEvent } from "./audit";
import { displayName } from "./email";

type DbClient = typeof prisma;

export const MAX_PAGE_SIZE = 100;

export type AdminTeamRow = {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  memberCount: number;
  activeMemberCount: number;
  adminCount: number;
  pendingInvitations: number;
  workspaceId: string | null;
  workspaceName: string | null;
  documentCount: number;
};

export async function listTeams(
  client: DbClient,
  actorId: string,
  query: { page: number; pageSize: number },
): Promise<{ teams: AdminTeamRow[]; total: number; page: number; pageSize: number }> {
  await requireAppAdmin(client, actorId);

  const page = Math.max(1, query.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize));

  const teams = await client.team.findMany({
    select: {
      id: true,
      name: true,
      archivedAt: true,
      createdAt: true,
      _count: { select: { members: true } },
      members: { where: { active: true }, select: { role: true, active: true } },
      workspaces: { where: { isDefault: true, kind: "TEAM" }, select: { id: true, name: true, _count: { select: { documents: true } } } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const counts = await Promise.all(
    teams.map(async (team) => ({
      pendingInvitations: await client.invitation.count({ where: { teamId: team.id, status: "PENDING" } }),
    })),
  );

  const total = await client.team.count();

  return {
    total,
    page,
    pageSize,
    teams: teams.map((team, index) => ({
      id: team.id,
      name: team.name,
      archivedAt: team.archivedAt,
      createdAt: team.createdAt,
      memberCount: team._count.members,
      activeMemberCount: team.members.filter((member) => member.active).length,
      adminCount: team.members.filter((member) => member.active && member.role === "ADMIN").length,
      pendingInvitations: counts[index].pendingInvitations,
      workspaceId: team.workspaces[0]?.id ?? null,
      workspaceName: team.workspaces[0]?.name ?? null,
      documentCount: team.workspaces[0]?._count.documents ?? 0,
    })),
  };
}

export type AdminDocumentRow = {
  id: string;
  title: string;
  slug: string;
  format: string;
  updatedAt: Date;
  createdAt: Date;
  author: { id: string; name: string; email: string };
  fileCount: number;
  lastSavedByAuthor: boolean;
};

/**
 * Paginated document metadata for one team's default workspace. Metadata only: content needs
 * inspectDocument, which records its own audit event.
 */
export async function listTeamDocuments(
  client: DbClient,
  actorId: string,
  teamId: string,
  query: { page: number; pageSize: number },
): Promise<{ documents: AdminDocumentRow[]; total: number; page: number; pageSize: number; workspaceId: string }> {
  await requireAppAdmin(client, actorId);

  const workspace = await client.workspace.findFirst({
    where: { teamId, kind: "TEAM", isDefault: true },
    select: { id: true },
  });
  if (!workspace) throw new AccessError("Team not found");

  const page = Math.max(1, query.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize));

  const [rows, total] = await Promise.all([
    client.document.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        title: true,
        slug: true,
        format: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { files: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.document.count({ where: { workspaceId: workspace.id } }),
  ]);

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.DOCUMENT_LISTED,
    teamId,
    workspaceId: workspace.id,
    // Count and page only. Never titles or author addresses in the metadata blob.
    metadata: { page, pageSize, total },
  });

  return {
    workspaceId: workspace.id,
    page,
    pageSize,
    total,
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      format: row.format,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: { id: row.user.id, name: displayName(row.user), email: row.user.email },
      fileCount: row._count.files,
      lastSavedByAuthor: true,
    })),
  };
}

/**
 * Explicit, audited content inspection. Read-only by construction: this module exposes no
 * write path, and the generic document routes never grant an app admin edit access.
 */
export async function inspectDocument(client: DbClient, actorId: string, documentId: string) {
  await requireAppAdmin(client, actorId);

  const document = await client.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      slug: true,
      format: true,
      mainFilePath: true,
      createdAt: true,
      updatedAt: true,
      workspaceId: true,
      workspace: { select: { id: true, name: true, kind: true, teamId: true, ownerUserId: true } },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      files: { select: { path: true, kind: true, sizeBytes: true, revision: true, updatedAt: true }, orderBy: { path: "asc" } },
    },
  });
  if (!document) throw new AccessError("Document not found");

  const main = await client.workspaceFile.findUnique({
    where: { documentId_path: { documentId: document.id, path: document.mainFilePath } },
    select: { content: true },
  });

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.DOCUMENT_INSPECTED,
    teamId: document.workspace.teamId,
    workspaceId: document.workspace.id,
    documentId: document.id,
    targetUserId: document.user.id,
    // Which file was read, never what it said.
    metadata: { mainFilePath: document.mainFilePath, format: document.format },
  });

  return {
    document: {
      id: document.id,
      title: document.title,
      slug: document.slug,
      format: document.format,
      mainFilePath: document.mainFilePath,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      author: { id: document.user.id, name: displayName(document.user), email: document.user.email },
      workspace: document.workspace,
      files: document.files,
      mainSource: main?.content ?? "",
      readOnly: true as const,
    },
  };
}

export async function listAuditEvents(client: DbClient, actorId: string, query: { page: number; pageSize: number; teamId?: string }) {
  await requireAppAdmin(client, actorId);
  const page = Math.max(1, query.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize));

  const where = query.teamId ? { teamId: query.teamId } : {};
  const [rows, total] = await Promise.all([
    client.adminAuditEvent.findMany({
      where,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actor: { select: { id: true, email: true } },
        teamId: true,
        workspaceId: true,
        documentId: true,
        targetUserId: true,
        metadata: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.adminAuditEvent.count({ where }),
  ]);

  return { total, page, pageSize, events: rows };
}

/**
 * One team as an administrator sees it: members with roles, pending invitations, the default
 * workspace, and the documents with their authors. Titles and addresses are shown to an app
 * admin by design; the audit event records that the team was read, not what it contained.
 */
export async function getTeamDetail(client: DbClient, actorId: string, teamId: string) {
  await requireAppAdmin(client, actorId);

  const team = await client.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      createdAt: true,
      createdById: true,
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
          active: true,
          joinedAt: true,
          removedAt: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      invitations: {
        select: { id: true, email: true, role: true, status: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      },
      workspaces: {
        where: { isDefault: true, kind: "TEAM" },
        select: {
          id: true,
          name: true,
          documents: {
            select: {
              id: true,
              title: true,
              slug: true,
              format: true,
              updatedAt: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
            orderBy: { updatedAt: "desc" },
            take: 50,
          },
        },
      },
    },
  });
  if (!team) throw new AccessError("Team not found");

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.DOCUMENT_LISTED,
    teamId: team.id,
    workspaceId: team.workspaces[0]?.id ?? null,
  });

  return {
    team: {
      id: team.id,
      name: team.name,
      archivedAt: team.archivedAt,
      createdAt: team.createdAt,
      createdById: team.createdById,
      workspace: team.workspaces[0] ?? null,
      members: team.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        role: member.role,
        active: member.active,
        joinedAt: member.joinedAt,
        removedAt: member.removedAt,
        name: displayName(member.user),
        email: member.user.email,
      })),
      invitations: team.invitations,
      documents: (team.workspaces[0]?.documents ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        slug: document.slug,
        format: document.format,
        updatedAt: document.updatedAt,
        author: { id: document.user.id, name: displayName(document.user), email: document.user.email },
      })),
    },
  };
}
