// Sharing: personal workspaces and single documents, plus revocation.
//
// Grants are created by invitation acceptance only, so nothing becomes visible before the
// recipient acts. Revocation writes a timestamp rather than deleting the row, which keeps the
// share history readable in the UI and takes effect on the next request because every read path
// re-derives access from these rows.

import { prisma } from './db';
import { getWorkspaceAccess, getDocumentAccess } from './access';
import { createInvitation, revokeInvitation, InvitationError } from './invitations';
import { recordAuditEvent } from './audit';

export class SharingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SharingError';
    this.status = status;
  }
}

function authorOnly(capabilities: { canShare: boolean } | null): asserts capabilities is { canShare: boolean } {
  if (!capabilities || !capabilities.canShare) throw new SharingError('Only the owner can share this', 403);
}

export type ShareRow = {
  id: string;
  kind: 'grant' | 'invitation';
  email: string;
  permission: 'VIEW';
  status: 'active' | 'pending' | 'revoked' | 'expired';
  since: Date;
  expiresAt: Date | null;
  /** Present in development only, for the invitation created by this exact request. */
  inviteUrl?: string;
};

function statusOf(invitation: { status: string; expiresAt: Date }): ShareRow['status'] {
  if (invitation.status === 'REVOKED') return 'revoked';
  if (invitation.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

async function sharesForWorkspace(workspaceId: string): Promise<ShareRow[]> {
  const [grants, invitations] = await Promise.all([
    prisma.workspaceGrant.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    prisma.invitation.findMany({ where: { workspaceId, target: 'WORKSPACE', status: { not: 'ACCEPTED' } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const userIds = grants.map((grant) => grant.recipientUserId);
  const recipients = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailById = new Map(recipients.map((user) => [user.id, user.email]));

  return [
    ...grants.map((grant) => ({
      id: grant.id,
      kind: 'grant' as const,
      email: emailById.get(grant.recipientUserId) ?? 'Removed account',
      permission: 'VIEW' as const,
      status: (grant.revokedAt ? 'revoked' : 'active') as ShareRow['status'],
      since: grant.acceptedAt ?? grant.createdAt,
      expiresAt: null,
    })),
    ...invitations.map((invitation) => ({
      id: invitation.id,
      kind: 'invitation' as const,
      email: invitation.targetEmail,
      permission: 'VIEW' as const,
      status: statusOf(invitation),
      since: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })),
  ];
}

async function sharesForDocument(documentId: string): Promise<ShareRow[]> {
  const [grants, invitations] = await Promise.all([
    prisma.documentGrant.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } }),
    prisma.invitation.findMany({ where: { documentId, target: 'DOCUMENT', status: { not: 'ACCEPTED' } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const userIds = grants.map((grant) => grant.recipientUserId);
  const recipients = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailById = new Map(recipients.map((user) => [user.id, user.email]));

  return [
    ...grants.map((grant) => ({
      id: grant.id,
      kind: 'grant' as const,
      email: emailById.get(grant.recipientUserId) ?? 'Removed account',
      permission: 'VIEW' as const,
      status: (grant.revokedAt ? 'revoked' : 'active') as ShareRow['status'],
      since: grant.acceptedAt ?? grant.createdAt,
      expiresAt: null,
    })),
    ...invitations.map((invitation) => ({
      id: invitation.id,
      kind: 'invitation' as const,
      email: invitation.targetEmail,
      permission: 'VIEW' as const,
      status: statusOf(invitation),
      since: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })),
  ];
}

/** A personal workspace may be shared by its owner only; team workspaces are shared by membership. */
export async function shareWorkspaceWithEmail(input: { actorUserId: string; workspaceId: string; email: string }) {
  const access = await getWorkspaceAccess(input.actorUserId, input.workspaceId);
  if (!access) throw new SharingError('Workspace not found', 404);
  if (access.workspace.kind !== 'PERSONAL') throw new SharingError('Team workspaces are shared with everyone in the team', 400);
  authorOnly(access.capabilities);

  const email = input.email.trim().toLowerCase();
  if (email === (await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { email: true } }))?.email.toLowerCase()) {
    throw new SharingError('You already have access to your own workspace');
  }

  const invitation = await createInvitation({
    inviterUserId: input.actorUserId,
    targetKind: 'WORKSPACE',
    targetEmail: email,
    target: { workspaceId: input.workspaceId },
    label: access.workspace.name,
    auditAction: 'workspace.share.create',
  });
  return invitation;
}

export async function shareDocumentWithEmail(input: { actorUserId: string; documentId: string; email: string }) {
  const access = await getDocumentAccess(input.actorUserId, input.documentId);
  if (!access) throw new SharingError('Document not found', 404);
  authorOnly(access.capabilities);

  const invitation = await createInvitation({
    inviterUserId: input.actorUserId,
    targetKind: 'DOCUMENT',
    targetEmail: input.email.trim().toLowerCase(),
    target: { documentId: access.document.id },
    label: access.document.title,
    auditAction: 'document.share.create',
  });
  return invitation;
}

export async function listWorkspaceShares(actorUserId: string, workspaceId: string) {
  const access = await getWorkspaceAccess(actorUserId, workspaceId);
  if (!access || !access.capabilities.canShare) throw new SharingError('Workspace not found', 404);
  return sharesForWorkspace(workspaceId);
}

export async function listDocumentShares(actorUserId: string, documentId: string) {
  const access = await getDocumentAccess(actorUserId, documentId);
  if (!access || !access.capabilities.canShare) throw new SharingError('Document not found', 404);
  return sharesForDocument(access.document.id);
}

/**
 * Revokes an accepted grant or a pending invitation. The caller must own the share, and the effect
 * is immediate: the next document, file, asset or PDF request re-reads these rows.
 */
export async function revokeWorkspaceShare(input: { actorUserId: string; workspaceId: string; shareId: string }) {
  const access = await getWorkspaceAccess(input.actorUserId, input.workspaceId);
  if (!access || !access.capabilities.canShare) throw new SharingError('Workspace not found', 404);

  const grant = await prisma.workspaceGrant.findUnique({ where: { id: input.shareId } });
  if (grant && grant.workspaceId === input.workspaceId) {
    await prisma.workspaceGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await recordAuditEvent({ actorUserId: input.actorUserId, action: 'workspace.share.revoke', workspaceId: input.workspaceId, targetUserId: grant.recipientUserId });
    return { kind: 'grant' as const };
  }
  const invitation = await prisma.invitation.findUnique({ where: { id: input.shareId } });
  if (invitation && invitation.workspaceId === input.workspaceId) {
    const result = await revokeInvitation(invitation.id, input.actorUserId);
    if (!result?.revoked) throw new SharingError('Only pending invitations can be revoked', 409);
    await recordAuditEvent({ actorUserId: input.actorUserId, action: 'workspace.share.revoke', workspaceId: input.workspaceId, metadata: { invitationOnly: true } });
    return { kind: 'invitation' as const };
  }
  throw new SharingError('That share does not belong to this workspace', 404);
}

export async function revokeDocumentShare(input: { actorUserId: string; documentId: string; shareId: string }) {
  const access = await getDocumentAccess(input.actorUserId, input.documentId);
  if (!access || !access.capabilities.canShare) throw new SharingError('Document not found', 404);

  const grant = await prisma.documentGrant.findUnique({ where: { id: input.shareId } });
  if (grant && grant.documentId === access.document.id) {
    await prisma.documentGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await recordAuditEvent({ actorUserId: input.actorUserId, action: 'document.share.revoke', documentId: access.document.id, targetUserId: grant.recipientUserId });
    return { kind: 'grant' as const };
  }
  const invitation = await prisma.invitation.findUnique({ where: { id: input.shareId } });
  if (invitation && invitation.documentId === access.document.id) {
    const result = await revokeInvitation(invitation.id, input.actorUserId);
    if (!result?.revoked) throw new SharingError('Only pending invitations can be revoked', 409);
    await recordAuditEvent({ actorUserId: input.actorUserId, action: 'document.share.revoke', documentId: access.document.id, metadata: { invitationOnly: true } });
    return { kind: 'invitation' as const };
  }
  throw new SharingError('That share does not belong to this document', 404);
}

export { InvitationError };
