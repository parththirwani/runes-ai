// Invitation and share service.
//
// An invitation is a promise about an email address; a grant is what actually authorises a
// request. Nothing in the permission layer looks at an invitation, so a pending, expired,
// revoked, or wrong-address invitation cannot open a document, a workspace, or a team.
//
// Tokens are random, single use, and stored as a SHA-256 hash. The raw token exists only in
// the response to the inviter (development delivery) and in the delivered link; it is never
// logged, never stored in the audit trail, and never returned to anyone but the inviter.

import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { AccessError, requireAppAdmin } from "./access";
import { requireDocumentEdit, requireWorkspaceRead } from "./access";
import { normalizeEmail } from "./email";
import { AuditAction, recordAuditEvent } from "./audit";
import { deliverInvitation, type InvitationDelivery } from "./invite-delivery";

type DbClient = typeof prisma;

export const INVITATION_TTL_DAYS = 7;
export const MAX_PENDING_INVITATIONS_PER_INVITER = 100;

export type InvitationTarget = "TEAM" | "WORKSPACE" | "DOCUMENT";

export type CreatedInvitation = {
  id: string;
  email: string;
  target: InvitationTarget;
  targetId: string;
  targetName: string;
  role: "ADMIN" | "MEMBER";
  status: string;
  expiresAt: Date;
  reused: boolean;
  delivery: InvitationDelivery;
};

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationPath(token: string): string {
  return "/invite/" + encodeURIComponent(token);
}

function targetData(target: InvitationTarget, targetId: string): { teamId?: string; workspaceId?: string; documentId?: string } {
  if (target === "TEAM") return { teamId: targetId };
  if (target === "WORKSPACE") return { workspaceId: targetId };
  return { documentId: targetId };
}

async function assertInviterCapacity(client: DbClient, inviterId: string) {
  const pending = await client.invitation.count({
    where: { inviterId, status: "PENDING", expiresAt: { gt: new Date() } },
  });
  if (pending >= MAX_PENDING_INVITATIONS_PER_INVITER) {
    throw new AccessError("Too many pending invitations. Revoke one before inviting again.", 409, "conflict");
  }
}

/**
 * Creates (or reuses) a pending invitation for a normalized email address.
 *
 * The response never says whether that address already has an account, so inviting cannot
 * be used to enumerate users.
 */
export async function createInvitation(
  client: DbClient,
  input: {
    inviterId: string;
    target: InvitationTarget;
    targetId: string;
    targetName: string;
    email: string;
    role?: "ADMIN" | "MEMBER";
    ttlDays?: number;
  },
): Promise<CreatedInvitation> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AccessError("Enter a valid email address", 400, "forbidden");
  await assertInviterCapacity(client, input.inviterId);

  const data = targetData(input.target, input.targetId);
  const existing = await client.invitation.findFirst({
    where: { email, target: input.target, status: "PENDING", ...data },
    select: { id: true, tokenHash: true, expiresAt: true },
  });

  if (existing && existing.expiresAt.getTime() > Date.now()) {
    // Only the hash is stored, so a resent invitation cannot reuse the delivered token.
    // Rotating it keeps the promise that a single link works exactly once.
    const resentToken = generateToken();
    await client.invitation.update({
      where: { id: existing.id },
      data: { tokenHash: hashToken(resentToken) },
    });
    return {
      id: existing.id,
      email,
      target: input.target,
      targetId: input.targetId,
      targetName: input.targetName,
      role: input.role ?? "MEMBER",
      status: "PENDING",
      expiresAt: existing.expiresAt,
      reused: true,
      delivery: await deliverInvitation({ token: resentToken, email, targetName: input.targetName, inviterId: input.inviterId }),
    };
  }

  if (existing) {
    await client.invitation.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? INVITATION_TTL_DAYS) * 86_400_000);

  const created = await client.invitation.create({
    data: {
      email,
      target: input.target,
      role: input.role ?? "MEMBER",
      tokenHash: hashToken(token),
      inviterId: input.inviterId,
      expiresAt,
      ...data,
    },
    select: { id: true },
  });

  await recordAuditEvent(client, {
    actorId: input.inviterId,
    action: input.target === "TEAM" ? AuditAction.MEMBER_INVITED : input.target === "WORKSPACE" ? AuditAction.WORKSPACE_SHARED : AuditAction.DOCUMENT_SHARED,
    teamId: input.target === "TEAM" ? input.targetId : null,
    workspaceId: input.target === "WORKSPACE" ? input.targetId : null,
    documentId: input.target === "DOCUMENT" ? input.targetId : null,
    // Email address and role only: no token, no document content.
    metadata: { email, role: input.role ?? "MEMBER" },
  });

  return {
    id: created.id,
    email,
    target: input.target,
    targetId: input.targetId,
    targetName: input.targetName,
    role: input.role ?? "MEMBER",
    status: "PENDING",
    expiresAt,
    reused: false,
    delivery: await deliverInvitation({ token, email, targetName: input.targetName, inviterId: input.inviterId }),
  };
}

/** Personal workspace share: the owner shares current and future documents. */
export async function shareWorkspace(client: DbClient, actorId: string, workspaceId: string, email: string) {
  const access = await requireWorkspaceRead(client, actorId, workspaceId);
  if (!access.capabilities.canShare) throw new AccessError("Workspace not found");
  return createInvitation(client, {
    inviterId: actorId,
    target: "WORKSPACE",
    targetId: workspaceId,
    targetName: access.workspace.name,
    email,
  });
}

/** Single document share: author only, one document, survives a workspace move. */
export async function shareDocument(client: DbClient, actorId: string, documentId: string, email: string) {
  const access = await requireDocumentEdit(client, actorId, documentId);
  return createInvitation(client, {
    inviterId: actorId,
    target: "DOCUMENT",
    targetId: documentId,
    targetName: access.document.title,
    email,
  });
}

/** Team invitation: team admin for their own team, app admin for any team. */
export async function inviteTeamMember(
  client: DbClient,
  actorId: string,
  teamId: string,
  email: string,
  role: "ADMIN" | "MEMBER",
) {
  const team = await client.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, archivedAt: true } });
  if (!team) throw new AccessError("Team not found");
  const membership = await client.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: actorId } },
    select: { role: true, active: true },
  });
  const isTeamAdmin = Boolean(membership && membership.active && membership.role === "ADMIN");
  if (!isTeamAdmin) await requireAppAdmin(client, actorId);
  if (team.archivedAt) throw new AccessError("This team is archived", 409, "conflict");

  return createInvitation(client, {
    inviterId: actorId,
    target: "TEAM",
    targetId: teamId,
    targetName: team.name,
    email,
    role,
  });
}

export type ShareRow = {
  id: string;
  email: string | null;
  recipientName: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  permission: "VIEW";
  createdAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
};

export async function listWorkspaceShares(client: DbClient, actorId: string, workspaceId: string): Promise<ShareRow[]> {
  const access = await requireWorkspaceRead(client, actorId, workspaceId);
  if (!access.capabilities.canShare) throw new AccessError("Workspace not found");
  return listShares(client, "WORKSPACE", workspaceId);
}

export async function listDocumentShares(client: DbClient, actorId: string, documentId: string): Promise<ShareRow[]> {
  await requireDocumentEdit(client, actorId, documentId);
  return listShares(client, "DOCUMENT", documentId);
}

async function listShares(client: DbClient, target: InvitationTarget, targetId: string): Promise<ShareRow[]> {
  const data = targetData(target, targetId);
  const [invitations, grants] = await Promise.all([
    client.invitation.findMany({
      where: { ...data, status: "PENDING" },
      select: { id: true, email: true, status: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
    target === "WORKSPACE"
      ? client.workspaceGrant.findMany({
          where: { workspaceId: targetId },
          select: {
            id: true,
            createdAt: true,
            acceptedAt: true,
            revokedAt: true,
            recipient: { select: { email: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : client.documentGrant.findMany({
          where: { documentId: targetId },
          select: {
            id: true,
            createdAt: true,
            acceptedAt: true,
            revokedAt: true,
            recipient: { select: { email: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
  ]);

  const pending: ShareRow[] = invitations.map((row) => ({
    id: row.id,
    email: row.email,
    recipientName: null,
    status: "PENDING" as const,
    permission: "VIEW" as const,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: null,
  }));

  const accepted: ShareRow[] = grants.map((row: Record<string, unknown>) => {
    const record = row as unknown as {
      id: string;
      createdAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      recipient: { email: string; firstName: string | null; lastName: string | null };
    };
    return {
      id: record.id,
      email: record.recipient.email,
      recipientName: [record.recipient.firstName, record.recipient.lastName].filter(Boolean).join(" ").trim() || record.recipient.email,
      status: (record.revokedAt ? "REVOKED" : "ACCEPTED") as ShareRow["status"],
      permission: "VIEW" as const,
      createdAt: record.createdAt,
      expiresAt: null,
      acceptedAt: record.acceptedAt,
    };
  });

  return [...pending, ...accepted];
}

export type PreviewResult = {
  state: "valid" | "expired" | "revoked" | "accepted" | "wrong-email" | "unknown";
  target: InvitationTarget | null;
  targetName: string | null;
  inviterName: string | null;
  permission: "VIEW" | "MEMBER" | "ADMIN";
  role: "ADMIN" | "MEMBER";
  expiresAt: Date | null;
};

/**
 * Renders the acceptance screen. Unknown and inaccessible tokens are indistinguishable, and
 * a token sent to another address reveals only that it belongs to someone else.
 */
export async function previewInvitation(client: DbClient, token: string, viewerEmail: string): Promise<PreviewResult> {
  const row = await client.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      target: true,
      role: true,
      status: true,
      expiresAt: true,
      inviter: { select: { firstName: true, lastName: true, email: true } },
      team: { select: { name: true } },
      workspace: { select: { name: true } },
      document: { select: { title: true } },
    },
  });

  if (!row) return unknownPreview();

  const targetName = row.team?.name ?? row.workspace?.name ?? row.document?.title ?? null;
  const inviterName = [row.inviter.firstName, row.inviter.lastName].filter(Boolean).join(" ").trim() || row.inviter.email;

  if (row.status === "ACCEPTED") {
    return { state: "accepted", target: row.target, targetName, inviterName, permission: permissionLabel(row), role: row.role, expiresAt: row.expiresAt };
  }
  if (row.status === "REVOKED" || row.status === "EXPIRED" || row.expiresAt.getTime() < Date.now()) {
    return { state: "expired", target: row.target, targetName, inviterName, permission: permissionLabel(row), role: row.role, expiresAt: row.expiresAt };
  }
  if (normalizeEmail(viewerEmail) !== row.email) {
    return { state: "wrong-email", target: row.target, targetName, inviterName, permission: permissionLabel(row), role: row.role, expiresAt: row.expiresAt };
  }

  return { state: "valid", target: row.target, targetName, inviterName, permission: permissionLabel(row), role: row.role, expiresAt: row.expiresAt };
}

function permissionLabel(row: { target: InvitationTarget; role: string }): "VIEW" | "MEMBER" | "ADMIN" {
  if (row.target === "TEAM") return row.role === "ADMIN" ? "ADMIN" : "MEMBER";
  return "VIEW";
}

function unknownPreview(): PreviewResult {
  return { state: "unknown", target: null, targetName: null, inviterName: null, permission: "VIEW", role: "MEMBER", expiresAt: null };
}

export type AcceptResult = {
  target: InvitationTarget;
  teamId: string | null;
  workspaceId: string | null;
  documentId: string | null;
  alreadyAccepted: boolean;
};

/**
 * Turns an accepted invitation into a grant or a membership. Idempotent: opening the same
 * link twice returns the same scope and does not duplicate a row.
 */
export async function acceptInvitation(client: DbClient, token: string, userId: string, viewerEmail: string): Promise<AcceptResult> {
  const tokenHash = hashToken(token);

  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invitations WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
    if (rows.length === 0) throw new AccessError("This invitation is no longer valid");

    const invitation = await tx.invitation.findUnique({
      where: { id: rows[0].id },
      select: {
        id: true,
        email: true,
        target: true,
        role: true,
        status: true,
        expiresAt: true,
        acceptedById: true,
        inviterId: true,
        teamId: true,
        workspaceId: true,
        documentId: true,
      },
    });
    if (!invitation) throw new AccessError("This invitation is no longer valid");

    const scope: AcceptResult = {
      target: invitation.target,
      teamId: invitation.teamId,
      workspaceId: invitation.workspaceId,
      documentId: invitation.documentId,
      alreadyAccepted: false,
    };

    const sameRecipient = invitation.acceptedById === userId;
    if (invitation.status === "ACCEPTED" && sameRecipient) return { ...scope, alreadyAccepted: true };
    if (invitation.status !== "PENDING") throw new AccessError("This invitation is no longer valid");
    if (invitation.expiresAt.getTime() < Date.now()) {
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      throw new AccessError("This invitation has expired");
    }
    if (normalizeEmail(viewerEmail) !== invitation.email) {
      // The address on the session must match the invited address; a copied link alone is
      // never enough.
      throw new AccessError("This invitation was sent to a different address", 403, "forbidden");
    }

    if (invitation.target === "TEAM" && invitation.teamId) {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: invitation.teamId, userId } },
        create: { teamId: invitation.teamId, userId, role: invitation.role },
        update: { active: true, role: invitation.role, removedAt: null },
      });
      await recordAuditEvent(tx, {
        actorId: userId,
        action: AuditAction.MEMBER_JOINED,
        teamId: invitation.teamId,
        targetUserId: userId,
        metadata: { role: invitation.role },
      });
    } else if (invitation.target === "WORKSPACE" && invitation.workspaceId) {
      await tx.workspaceGrant.upsert({
        where: { workspaceId_recipientId: { workspaceId: invitation.workspaceId, recipientId: userId } },
        create: { workspaceId: invitation.workspaceId, recipientId: userId, permission: "VIEW", invitedById: invitation.inviterId ?? null, acceptedAt: new Date() },
        update: { permission: "VIEW", revokedAt: null, acceptedAt: new Date(), invitedById: invitation.inviterId ?? null },
      });
    } else if (invitation.target === "DOCUMENT" && invitation.documentId) {
      await tx.documentGrant.upsert({
        where: { documentId_recipientId: { documentId: invitation.documentId, recipientId: userId } },
        create: { documentId: invitation.documentId, recipientId: userId, permission: "VIEW", invitedById: invitation.inviterId ?? null, acceptedAt: new Date() },
        update: { permission: "VIEW", revokedAt: null, acceptedAt: new Date(), invitedById: invitation.inviterId ?? null },
      });
    } else {
      throw new AccessError("This invitation is no longer valid");
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedById: userId, acceptedAt: new Date() },
    });

    return scope;
  }, { isolationLevel: "Serializable" });
}

/** Revokes a pending invitation or an accepted share. Takes effect on the next request. */
export async function revokeShare(
  client: DbClient,
  actorId: string,
  input: { kind: "invitation" | "workspace-grant" | "document-grant"; id: string; workspaceId?: string; documentId?: string },
): Promise<void> {
  if (input.kind === "invitation") {
    const invitation = await client.invitation.findUnique({
      where: { id: input.id },
      select: { id: true, inviterId: true, status: true, target: true, teamId: true, workspaceId: true, documentId: true },
    });
    if (!invitation || invitation.inviterId !== actorId) throw new AccessError("Invitation not found");
    await client.invitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await recordAuditEvent(client, {
      actorId,
      action: invitation.target === "WORKSPACE" ? AuditAction.WORKSPACE_SHARE_REVOKED : AuditAction.DOCUMENT_SHARE_REVOKED,
      teamId: invitation.teamId,
      workspaceId: invitation.workspaceId,
      documentId: invitation.documentId,
    });
    return;
  }

  if (input.kind === "workspace-grant") {
    const grant = await client.workspaceGrant.findUnique({
      where: { id: input.id },
      select: { id: true, workspaceId: true, revokedAt: true, workspace: { select: { ownerUserId: true } } },
    });
    if (!grant || grant.workspace.ownerUserId !== actorId) throw new AccessError("Share not found");
    await client.workspaceGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await recordAuditEvent(client, { actorId, action: AuditAction.WORKSPACE_SHARE_REVOKED, workspaceId: grant.workspaceId });
    return;
  }

  const grant = await client.documentGrant.findUnique({
    where: { id: input.id },
    select: { id: true, documentId: true, revokedAt: true, document: { select: { userId: true } } },
  });
  if (!grant || grant.document.userId !== actorId) throw new AccessError("Share not found");
  await client.documentGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  await recordAuditEvent(client, { actorId, action: AuditAction.DOCUMENT_SHARE_REVOKED, documentId: grant.documentId });
}
