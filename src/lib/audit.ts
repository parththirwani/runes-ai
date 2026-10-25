// Audit trail for administrative and sharing actions.
//
// Rows hold ids and a small metadata object only. Never write document content, document
// source, or an invitation token here (see docs/workspaces-teams-access-plan.md, Admin
// boundaries, and the checklist item "the final diff contains no live invite tokens").

import type { Prisma } from "../generated/prisma/client";

type AuditClient = {
  adminAuditEvent: {
    create: (input: {
      data: {
        actorId: string;
        action: string;
        teamId?: string | null;
        workspaceId?: string | null;
        documentId?: string | null;
        targetUserId?: string | null;
        metadata?: Prisma.InputJsonValue;
      };
    }) => Promise<unknown>;
  };
};

export const AuditAction = {
  TEAM_CREATED: "team.created",
  TEAM_ARCHIVED: "team.archived",
  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_REMOVED: "member.removed",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  WORKSPACE_CREATED: "workspace.created",
  WORKSPACE_SHARED: "workspace.shared",
  WORKSPACE_SHARE_REVOKED: "workspace.share_revoked",
  DOCUMENT_SHARED: "document.shared",
  DOCUMENT_SHARE_REVOKED: "document.share_revoked",
  DOCUMENT_MOVED: "document.moved",
  DOCUMENT_INSPECTED: "document.inspected",
  DOCUMENT_LISTED: "document.listed",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export async function recordAuditEvent(
  client: AuditClient,
  event: {
    actorId: string;
    action: AuditActionValue;
    teamId?: string | null;
    workspaceId?: string | null;
    documentId?: string | null;
    targetUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.adminAuditEvent.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      teamId: event.teamId ?? null,
      workspaceId: event.workspaceId ?? null,
      documentId: event.documentId ?? null,
      targetUserId: event.targetUserId ?? null,
      metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Team member lists are the common read that has to name the actor, so removals expose the
 * acting user id in metadata for the admin dashboard to display.
 */
export async function recordMemberRemoval(
  client: AuditClient,
  input: { actorId: string; teamId: string; targetUserId: string; role: string; viaAppAdmin: boolean },
): Promise<void> {
  await recordAuditEvent(client, {
    actorId: input.actorId,
    action: AuditAction.MEMBER_REMOVED,
    teamId: input.teamId,
    targetUserId: input.targetUserId,
    metadata: { role: input.role, viaAppAdmin: input.viaAppAdmin, removedByUserId: input.actorId },
  });
}
