// Append-only audit trail for administrative actions.
//
// Rows carry ids and a small metadata blob only. Document content and invitation tokens must never
// be written here; the metadata column is free-form by design, so the only way to keep it clean is
// to construct it in one place.

import { prisma } from './db';

export type AuditAction =
  | 'team.create'
  | 'team.member.invite'
  | 'team.member.remove'
  | 'team.member.role'
  | 'workspace.share.create'
  | 'workspace.share.revoke'
  | 'document.share.create'
  | 'document.share.revoke'
  | 'document.inspect'
  | 'admin.provision';

export type AuditInput = {
  actorUserId: string | null;
  action: AuditAction;
  teamId?: string | null;
  workspaceId?: string | null;
  documentId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, string | number | boolean>;
};

export async function recordAuditEvent(input: AuditInput) {
  return prisma.adminAuditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      teamId: input.teamId ?? null,
      workspaceId: input.workspaceId ?? null,
      documentId: input.documentId ?? null,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ? (input.metadata as Record<string, never>) : undefined,
    },
  });
}

export async function listAuditEvents(options: { teamId?: string; take?: number; cursor?: string } = {}) {
  const events = await prisma.adminAuditEvent.findMany({
    where: options.teamId ? { teamId: options.teamId } : undefined,
    include: { actor: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.take ?? 50, 200),
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  return events.map((event) => ({
    id: event.id,
    action: event.action,
    createdAt: event.createdAt,
    teamId: event.teamId,
    workspaceId: event.workspaceId,
    documentId: event.documentId,
    targetUserId: event.targetUserId,
    metadata: event.metadata,
    actor: event.actor
      ? { id: event.actor.id, email: event.actor.email, name: `${event.actor.firstName ?? ''} ${event.actor.lastName ?? ''}`.trim() || event.actor.email }
      : null,
  }));
}
