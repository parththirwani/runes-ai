// Invitations: create, preview, accept, revoke.
//
// Security properties this module is responsible for:
//   * Only the SHA-256 of the token is stored, so a database read cannot mint a link.
//   * A token alone never grants access. Acceptance additionally requires the signed-in account
//     whose verified email equals the normalized address the invitation was issued to, so copying
//     a link into another browser does nothing.
//   * Pending, expired, revoked and already-revoked invitations authorize nothing.
//   * Acceptance is idempotent: replaying it returns the same result instead of duplicating a
//     membership or grant.
//   * Creating an invitation never says whether the address already has an account.

import { createHash, randomBytes } from 'crypto';
import { prisma } from './db';
import { recordAuditEvent } from './audit';
import { deliverInvitation, invitationUrl, canShowInviteLinkToInviter } from './email';

export type InvitationTargetKind = 'TEAM' | 'WORKSPACE' | 'DOCUMENT';

export const INVITATION_TTL_DAYS = 7;
export const MAX_INVITATIONS_PER_HOUR = 20;
export const MAX_PENDING_INVITATIONS = 50;

export class InvitationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InvitationError';
    this.status = status;
  }
}

/** One canonical form everywhere: comparison, storage and matching all use this. */
export function normalizeEmail(input: unknown): string {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvitationError('Enter a valid email address');
  }
  return email;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}

export function newInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export type CreatedInvitation = {
  id: string;
  targetKind: InvitationTargetKind;
  targetLabel: string;
  invitedEmail: string;
  expiresAt: Date;
  /** Present only outside production and only to the inviter; never persisted and never logged. */
  inviteUrl?: string;
  delivery: 'email' | 'manual';
};

type TargetRow = { teamId?: string | null; workspaceId?: string | null; documentId?: string | null };

async function assertInvitationQuota(inviterUserId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [recent, pending] = await Promise.all([
    prisma.invitation.count({ where: { inviterUserId, createdAt: { gte: since } } }),
    prisma.invitation.count({ where: { inviterUserId, status: 'PENDING', revokedAt: null } }),
  ]);
  if (recent >= MAX_INVITATIONS_PER_HOUR) {
    throw new InvitationError('Too many invitations in the last hour. Try again later.', 429);
  }
  if (pending >= MAX_PENDING_INVITATIONS) {
    throw new InvitationError('You have too many unanswered invitations. Revoke some first.', 429);
  }
}

/**
 * Creates one invitation. Callers must have already established that `inviterUserId` is allowed to
 * share the target, and must pass a label that is safe to show both parties.
 */
export async function createInvitation(input: {
  inviterUserId: string;
  targetKind: InvitationTargetKind;
  targetEmail: string;
  target: TargetRow;
  label: string;
  auditAction: 'team.member.invite' | 'workspace.share.create' | 'document.share.create';
}): Promise<CreatedInvitation> {
  const targetEmail = normalizeEmail(input.targetEmail);
  await assertInvitationQuota(input.inviterUserId);

  const token = newInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    // Resending replaces the previous live link instead of stacking two usable tokens.
    await tx.invitation.updateMany({
      where: {
        targetEmail,
        status: 'PENDING',
        revokedAt: null,
        teamId: input.target.teamId ?? null,
        workspaceId: input.target.workspaceId ?? null,
        documentId: input.target.documentId ?? null,
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return tx.invitation.create({
      data: {
        target: input.targetKind,
        targetEmail,
        inviterUserId: input.inviterUserId,
        teamId: input.target.teamId ?? null,
        workspaceId: input.target.workspaceId ?? null,
        documentId: input.target.documentId ?? null,
        tokenHash: hashInvitationToken(token),
        expiresAt,
      },
    });
  });

  const inviter = await prisma.user.findUnique({ where: { id: input.inviterUserId }, select: { firstName: true, lastName: true, email: true } });
  const inviterName = `${inviter?.firstName ?? ''} ${inviter?.lastName ?? ''}`.trim() || inviter?.email || 'Someone';
  const delivery = await deliverInvitation({ to: targetEmail, inviterName, targetLabel: input.label, token });

  await recordAuditEvent({
    actorUserId: input.inviterUserId,
    action: input.auditAction,
    teamId: input.target.teamId ?? null,
    workspaceId: input.target.workspaceId ?? null,
    documentId: input.target.documentId ?? null,
    metadata: { delivered: delivery.delivered ? 'email' : 'manual', channel: delivery.delivered ? delivery.channel : delivery.reason },
  });

  return {
    id: created.id,
    targetKind: input.targetKind,
    targetLabel: input.label,
    invitedEmail: targetEmail,
    expiresAt,
    delivery: delivery.delivered ? 'email' : 'manual',
    ...(canShowInviteLinkToInviter() ? { inviteUrl: invitationUrl(token) } : {}),
  };
}

export type InvitationPreview =
  | { state: 'unknown' }
  | { state: 'expired'; inviterName: string; targetLabel: string }
  | { state: 'revoked'; inviterName: string; targetLabel: string }
  | { state: 'accepted-by-you' }
  | { state: 'accepted' }
  | { state: 'wrong-email'; signedInEmail: string }
  | { state: 'valid'; id: string; targetKind: InvitationTargetKind; targetLabel: string; inviterName: string; permission: 'VIEW'; expiresAt: Date };

function labelFor(invitation: {
  target: InvitationTargetKind;
  team?: { name: string } | null;
  workspace?: { name: string } | null;
  document?: { title: string } | null;
}): string {
  if (invitation.target === 'TEAM') return invitation.team?.name ?? 'a team';
  if (invitation.target === 'WORKSPACE') return invitation.workspace?.name ?? 'a workspace';
  return invitation.document?.title ?? 'a document';
}

async function loadInvitation(token: string) {
  const tokenHash = hashInvitationToken(token);
  return prisma.invitation.findUnique({
    where: { tokenHash },
    include: {
      team: { select: { name: true } },
      workspace: { select: { name: true } },
      document: { select: { title: true } },
      inviter: { select: { email: true, firstName: true, lastName: true } },
    },
  });
}

function inviterName(inviter: { email: string; firstName: string | null; lastName: string | null }): string {
  return `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email;
}

/** Read-only view used by the acceptance page. Performs no authorization beyond the token. */
export async function previewInvitation(token: string, viewer: { userId: string; email: string }): Promise<InvitationPreview> {
  const invitation = await loadInvitation(token);
  if (!invitation) return { state: 'unknown' };
  const name = inviterName(invitation.inviter);
  const label = labelFor(invitation);

  if (invitation.status === 'ACCEPTED') {
    return invitation.acceptedById === viewer.userId ? { state: 'accepted-by-you' } : { state: 'accepted' };
  }
  if (invitation.status === 'REVOKED' || invitation.revokedAt !== null) return { state: 'revoked', inviterName: name, targetLabel: label };
  if (invitation.status === 'EXPIRED' || invitation.expiresAt.getTime() <= Date.now()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } }).catch(() => undefined);
    return { state: 'expired', inviterName: name, targetLabel: label };
  }
  if (viewer.email.toLowerCase() !== invitation.targetEmail) {
    // Deliberately does not reveal the invited address.
    return { state: 'wrong-email', signedInEmail: viewer.email };
  }
  return {
    state: 'valid',
    id: invitation.id,
    targetKind: invitation.target,
    targetLabel: label,
    inviterName: name,
    permission: 'VIEW',
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accepts an invitation as the signed-in user. Everything that decides access happens inside one
 * transaction, and a second call by the same user returns success without side effects.
 */
export async function acceptInvitation(token: string, viewer: { userId: string; email: string }): Promise<
  | { ok: true; preview: Extract<InvitationPreview, { state: 'valid' }> }
  | { ok: false; preview: InvitationPreview }
> {
  const invitation = await loadInvitation(token);
  if (!invitation) return { ok: false, preview: { state: 'unknown' } };

  const preview = await previewInvitation(token, viewer);
  if (preview.state === 'accepted-by-you') {
    return { ok: true, preview: { state: 'valid', id: invitation.id, targetKind: invitation.target, targetLabel: labelFor(invitation), inviterName: inviterName(invitation.inviter), permission: 'VIEW', expiresAt: invitation.expiresAt } };
  }
  if (preview.state !== 'valid') return { ok: false, preview };

  // Re-read the account's verified email at mutation time rather than trusting the page state.
  const account = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { email: true } });
  if (!account || account.email.toLowerCase() !== invitation.targetEmail) {
    return { ok: false, preview: { state: 'wrong-email', signedInEmail: viewer.email } };
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // Claim the pending token before granting access. The conditional update locks this row,
    // so a concurrent revocation cannot slip between validation and grant creation.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', revokedAt: null, expiresAt: { gt: now } },
      data: { status: 'ACCEPTED', acceptedById: viewer.userId, acceptedAt: now },
    });
    if (claimed.count !== 1) {
      throw new InvitationError('This invitation is no longer valid', 410);
    }

    if (invitation.target === 'TEAM') {
      if (!invitation.teamId) throw new InvitationError('This invitation is incomplete', 410);
      const existing = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: invitation.teamId, userId: viewer.userId } } });
      if (existing) {
        await tx.teamMember.update({ where: { id: existing.id }, data: { active: true, removedAt: null } });
      } else {
        await tx.teamMember.create({ data: { teamId: invitation.teamId, userId: viewer.userId, role: 'MEMBER', active: true } });
      }
    } else if (invitation.target === 'WORKSPACE') {
      if (!invitation.workspaceId) throw new InvitationError('This invitation is incomplete', 410);
      await tx.workspaceGrant.upsert({
        where: { workspaceId_recipientUserId: { workspaceId: invitation.workspaceId, recipientUserId: viewer.userId } },
        create: { workspaceId: invitation.workspaceId, recipientUserId: viewer.userId, permission: 'VIEW', acceptedAt: now },
        update: { permission: 'VIEW', acceptedAt: now, revokedAt: null },
      });
    } else {
      if (!invitation.documentId) throw new InvitationError('This invitation is incomplete', 410);
      await tx.documentGrant.upsert({
        where: { documentId_recipientUserId: { documentId: invitation.documentId, recipientUserId: viewer.userId } },
        create: { documentId: invitation.documentId, recipientUserId: viewer.userId, permission: 'VIEW', acceptedAt: now },
        update: { permission: 'VIEW', acceptedAt: now, revokedAt: null },
      });
    }

  });

  return { ok: true, preview };
}

/** Closes a live invitation. Idempotent: revoking twice is not an error. */
export async function revokeInvitation(invitationId: string, actorUserId: string) {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) return null;
  if (invitation.inviterUserId !== actorUserId) return { forbidden: true as const };
  const result = await prisma.invitation.updateMany({
    where: { id: invitationId, status: 'PENDING', revokedAt: null },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  return { forbidden: false as const, revoked: result.count > 0 };
}

/** Marks every still-pending invitation past its expiry as EXPIRED. Safe to call repeatedly. */
export async function expireStaleInvitations(): Promise<number> {
  const result = await prisma.invitation.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
