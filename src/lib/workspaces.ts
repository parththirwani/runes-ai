// Workspace (document collection) service.
//
// `Workspace` is a collection of documents; `WorkspaceFile` remains one file inside one
// document. Everything here is capability-checked through src/lib/access.ts, and writes that
// change document placement re-check inside the transaction that performs the change.

import { prisma } from "./db";
import {
  AccessError,
  capabilitiesForMany,
  requireDocumentEdit,
  requireWorkspaceCreate,
  requireWorkspaceRead,
  listAccessibleWorkspaces,
} from "./access";
import { ensureDefaultPersonalWorkspace } from "./workspace-ownership";
import { generateSlug } from "./slug";
import { latexTemplate, markdownTemplate } from "./templates";
import { AuditAction, recordAuditEvent } from "./audit";

type DbClient = typeof prisma;

export const MAX_WORKSPACES_PER_USER = 20;
export const MAX_WORKSPACE_NAME_LENGTH = 40;

export function validateWorkspaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new AccessError("Workspace name is required", 400, "forbidden");
  if (trimmed.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new AccessError("Workspace name is too long", 400, "forbidden");
  }
  return trimmed;
}

/** Creates an additional personal workspace. The default one comes from sign-in. */
export async function createPersonalWorkspace(client: DbClient, userId: string, name: string): Promise<{ id: string; name: string }> {
  const trimmed = validateWorkspaceName(name);
  const count = await client.workspace.count({ where: { ownerUserId: userId } });
  if (count >= MAX_WORKSPACES_PER_USER) {
    throw new AccessError("Workspace limit reached", 409, "conflict");
  }
  const workspace = await client.workspace.create({
    data: { name: trimmed, kind: "PERSONAL", ownerUserId: userId, isDefault: false },
    select: { id: true, name: true },
  });
  await recordAuditEvent(client, {
    actorId: userId,
    action: AuditAction.WORKSPACE_CREATED,
    workspaceId: workspace.id,
    metadata: { kind: "PERSONAL", name: workspace.name },
  });
  return workspace;
}

export async function renameWorkspace(client: DbClient, userId: string, workspaceId: string, name: string): Promise<{ id: string; name: string }> {
  const access = await requireWorkspaceRead(client, userId, workspaceId);
  if (!access.capabilities.canRename) throw new AccessError("Workspace not found");
  const trimmed = validateWorkspaceName(name);
  return client.workspace.update({ where: { id: workspaceId }, data: { name: trimmed }, select: { id: true, name: true } });
}

async function emailOf(client: DbClient, userId: string): Promise<string> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? "";
}

/**
 * Lists every workspace the user can open, with the document count and the user's own
 * capabilities, plus a pending-invitation count so the library can offer acceptance without a
 * second request.
 */
export async function listWorkspacesWithCounts(client: DbClient, userId: string) {
  const email = await emailOf(client, userId);
  const [workspaces, pendingInvitations] = await Promise.all([
    listAccessibleWorkspaces(client, userId),
    client.invitation.count({ where: { email: email.toLowerCase(), status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);

  const details = await Promise.all(
    workspaces.map(async (workspace) => {
      const [documentCount, team] = await Promise.all([
        client.document.count({ where: { workspaceId: workspace.workspace.id } }),
        workspace.workspace.teamId
          ? client.team.findUnique({ where: { id: workspace.workspace.teamId }, select: { name: true } })
          : Promise.resolve(null),
      ]);
      return { documentCount, teamName: team?.name ?? null };
    }),
  );

  return {
    pendingInvitations,
    workspaces: workspaces.map((workspace, index) => ({
      ...workspace.workspace,
      teamName: details[index].teamName,
      documentCount: details[index].documentCount,
      capabilities: workspace.capabilities,
    })),
  };
}

export type CreatedDocument = {
  id: string;
  title: string;
  slug: string;
  format: "LATEX" | "MARKDOWN";
  workspaceId: string;
};

/**
 * Creates a document inside a workspace the user may create in. The author stays `userId`,
 * which is what keeps editing author-only later on.
 */
export async function createDocumentInWorkspace(
  client: DbClient,
  userId: string,
  workspaceId: string | null | undefined,
  input: { title: string; format: "LATEX" | "MARKDOWN"; content?: string },
): Promise<CreatedDocument> {
  const targetWorkspaceId = workspaceId ?? (await ensureDefaultPersonalWorkspace(client, userId)).workspaceId;
  await requireWorkspaceCreate(client, userId, targetWorkspaceId);

  const title = input.title.trim();
  const slug = generateSlug(title);
  const source = input.content ?? (input.format === "MARKDOWN" ? markdownTemplate(title) : latexTemplate(title));

  try {
    return await client.document.create({
      data: {
        title,
        slug,
        content: source,
        format: input.format,
        mainFilePath: input.format === "MARKDOWN" ? "main.md" : "main.tex",
        userId,
        workspaceId: targetWorkspaceId,
      },
      select: { id: true, title: true, slug: true, format: true, workspaceId: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AccessError("A document with this name already exists in this workspace", 409, "conflict");
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export type MovePreview = {
  documentId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  grantsTeamAccess: boolean;
  removesTeamAccess: boolean;
  keepsDirectShares: boolean;
  collision: string | null;
};

async function findMoveCollision(client: DbClient, documentId: string, toWorkspaceId: string): Promise<string | null> {
  const moving = await client.document.findUnique({ where: { id: documentId }, select: { title: true, slug: true } });
  if (!moving) throw new AccessError("Document not found");
  const clash = await client.document.findFirst({
    where: { workspaceId: toWorkspaceId, id: { not: documentId }, OR: [{ title: moving.title }, { slug: moving.slug }] },
    select: { title: true },
  });
  return clash ? clash.title : null;
}

async function teamIdOf(client: DbClient, workspaceId: string): Promise<string | null> {
  const workspace = await client.workspace.findUnique({ where: { id: workspaceId }, select: { teamId: true } });
  return workspace?.teamId ?? null;
}

/** What a move would change about who can see the document. Shown before the user confirms. */
export async function describeMove(client: DbClient, actorId: string, documentId: string, toWorkspaceId: string): Promise<MovePreview> {
  const access = await requireDocumentEdit(client, actorId, documentId);
  if (!access.capabilities.canMove) throw new AccessError("Document not found");

  const target = await requireWorkspaceCreate(client, actorId, toWorkspaceId);
  const collision = await findMoveCollision(client, documentId, toWorkspaceId);
  const sourceTeamId = await teamIdOf(client, access.document.workspaceId);

  return {
    documentId,
    fromWorkspaceId: access.document.workspaceId,
    toWorkspaceId,
    grantsTeamAccess: target.workspace.kind === "TEAM" && target.workspace.teamId !== sourceTeamId,
    removesTeamAccess: Boolean(sourceTeamId) && target.workspace.teamId !== sourceTeamId,
    keepsDirectShares: true,
    collision,
  };
}

/**
 * Moves an authored document between workspaces the author may create in. Permission,
 * membership, and collisions are re-read inside the transaction, so a move cannot slip
 * through after a membership or share changed underneath it.
 */
export async function moveDocument(client: DbClient, actorId: string, documentId: string, toWorkspaceId: string): Promise<MovePreview> {
  const preview = await describeMove(client, actorId, documentId, toWorkspaceId);
  if (preview.collision) {
    throw new AccessError("That workspace already has a document called " + preview.collision, 409, "conflict");
  }

  await client.$transaction(async (tx) => {
    const document = await tx.document.findUnique({
      where: { id: documentId },
      select: { id: true, userId: true, workspaceId: true, title: true, slug: true },
    });
    if (!document || document.userId !== actorId) throw new AccessError("Document not found");

    const target = await tx.workspace.findUnique({
      where: { id: toWorkspaceId },
      select: { id: true, kind: true, ownerUserId: true, teamId: true },
    });
    if (!target) throw new AccessError("Workspace not found");

    const allowed =
      (target.kind === "PERSONAL" && target.ownerUserId === actorId) ||
      (target.kind === "TEAM" &&
        (await tx.teamMember.count({ where: { teamId: target.teamId ?? "", userId: actorId, active: true } })) > 0);
    if (!allowed) throw new AccessError("Workspace not found");

    const collision = await tx.document.count({
      where: { workspaceId: toWorkspaceId, id: { not: documentId }, OR: [{ title: document.title }, { slug: document.slug }] },
    });
    if (collision > 0) throw new AccessError("That workspace already has a document with this name", 409, "conflict");

    await tx.document.update({ where: { id: documentId }, data: { workspaceId: toWorkspaceId } });
  });

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.DOCUMENT_MOVED,
    documentId,
    workspaceId: toWorkspaceId,
    metadata: {
      fromWorkspaceId: preview.fromWorkspaceId,
      grantsTeamAccess: preview.grantsTeamAccess,
      removesTeamAccess: preview.removesTeamAccess,
    },
  });

  return preview;
}

/** Documents in one readable workspace, with author identity and per-document capability. */
export async function listDocumentsInWorkspace(client: DbClient, userId: string, workspaceId: string, search?: string) {
  const access = await requireWorkspaceRead(client, userId, workspaceId);
  const rows = await client.document.findMany({
    where: {
      workspaceId,
      ...(search && search.length > 0
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { slug: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      format: true,
      isFavorite: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, image: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const capabilities = await capabilitiesForMany(client, userId, rows.map((row) => row.id));

  return {
    workspace: { ...access.workspace, capabilities: access.capabilities },
    documents: rows
      .filter((row) => capabilities.has(row.id))
      .map((row) => {
        const caps = capabilities.get(row.id);
        return {
          id: row.id,
          title: row.title,
          slug: row.slug,
          format: row.format,
          isFavorite: row.isFavorite,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          author: {
            id: row.user.id,
            name: [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim() || row.user.email,
            image: row.user.image,
          },
          access: caps?.access ?? null,
          canEdit: caps?.canEdit ?? false,
          canShare: caps?.canShare ?? false,
        };
      }),
  };
}
