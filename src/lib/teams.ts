// Teams, their single default workspace, and membership administration.
//
// Team admins may invite and remove members inside their own team only; app admins may create
// teams and act anywhere. Neither gains the right to edit a document they did not author — that
// rule lives in src/lib/access.ts and is not repeated here.

import { prisma } from './db';
import { recordAuditEvent } from './audit';
import { createInvitation, InvitationError } from './invitations';
import { getAppAdminUser } from './access';

export const MAX_TEAM_NAME_CHARS = 60;

export class TeamError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TeamError';
    this.status = status;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

export type TeamActor = { userId: string; isAdmin: boolean };

/**
 * Creates the team, its first ADMIN membership and its default workspace in one transaction.
 * There is no intermediate state in which a team exists without a workspace or without an admin:
 * a partially created team would be unmanageable, and the default workspace is the thing members
 * are actually given access to.
 */
export async function createTeam(input: { name: string; createdById: string }) {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length === 0) throw new TeamError('Team name is required');
  if (name.length > MAX_TEAM_NAME_CHARS) throw new TeamError('Team name is longer than ' + MAX_TEAM_NAME_CHARS + ' characters');

  try {
    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({ data: { name, createdById: input.createdById } });
      await tx.teamMember.create({ data: { teamId: created.id, userId: input.createdById, role: 'ADMIN', active: true } });
      await tx.workspace.create({ data: { name, kind: 'TEAM', teamId: created.id, isDefault: true } });
      return created;
    });
    await recordAuditEvent({ actorUserId: input.createdById, action: 'team.create', teamId: team.id, metadata: { name: team.name } });
    return team;
  } catch (error) {
    if (isUniqueViolation(error)) throw new TeamError('A team named ' + name + ' already exists', 409);
    throw error;
  }
}

export async function listTeamsForUser(userId: string) {
  const memberships = await prisma.teamMember.findMany({
    where: { userId, active: true },
    include: { team: { include: { workspaces: { where: { kind: 'TEAM', isDefault: true }, select: { id: true } } } } },
    orderBy: { joinedAt: 'asc' },
  });
  return memberships.map((membership) => ({
    id: membership.team.id,
    name: membership.team.name,
    role: membership.role,
    workspaceId: membership.team.workspaces[0]?.id ?? null,
    archivedAt: membership.team.archivedAt,
  }));
}

/** Resolves the caller's standing in a team, honouring the app-admin override for management. */
export async function resolveTeamActor(teamId: string, userId: string): Promise<
  { teamId: string; role: 'ADMIN' | 'MEMBER'; isAppAdmin: boolean } | null
> {
  const membership = await prisma.teamMember.findFirst({ where: { teamId, userId, active: true } });
  if (membership) return { teamId, role: membership.role, isAppAdmin: false };
  const appAdmin = await getAppAdminUser(userId);
  if (!appAdmin) return null;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
  return team ? { teamId, role: 'ADMIN', isAppAdmin: true } : null;
}

export async function listTeamMembers(teamId: string) {
  const members = await prisma.teamMember.findMany({
    where: { teamId, active: true },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    email: membership.user.email,
    name: `${membership.user.firstName ?? ''} ${membership.user.lastName ?? ''}`.trim() || membership.user.email,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }));
}

export async function listTeamInvitations(teamId: string) {
  const invitations = await prisma.invitation.findMany({
    where: { teamId },
    include: { inviter: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.targetEmail,
    status: invitation.expiresAt.getTime() <= Date.now() && invitation.status === 'PENDING' ? 'EXPIRED' : invitation.status,
    invitedBy: invitation.inviter.email,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  }));
}

export async function inviteTeamMember(input: { actorUserId: string; teamId: string; email: string }) {
  const actor = await resolveTeamActor(input.teamId, input.actorUserId);
  if (!actor || actor.role !== 'ADMIN') throw new TeamError('Only a team admin can invite members', 403);

  const team = await prisma.team.findUnique({ where: { id: input.teamId }, select: { id: true, name: true } });
  if (!team) throw new TeamError('Team not found', 404);

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.teamMember.findFirst({
    where: { teamId: team.id, active: true, user: { email } },
    select: { userId: true },
  });
  if (existing) {
    // Same response either way: an invitation must not confirm that an address is registered.
    return { alreadyMember: true as const, invitation: null };
  }

  const invitation = await createInvitation({
    inviterUserId: input.actorUserId,
    targetKind: 'TEAM',
    targetEmail: email,
    target: { teamId: team.id },
    label: team.name,
    auditAction: 'team.member.invite',
  });
  return { alreadyMember: false as const, invitation };
}

/**
 * Removes a member. The last remaining active admin cannot be removed, and the check runs inside
 * a serializable transaction so two simultaneous removals cannot each see a different admin as
 * "not the last one" and leave the team without one.
 */
export async function removeTeamMember(input: { actorUserId: string; teamId: string; membershipId: string }) {
  const actor = await resolveTeamActor(input.teamId, input.actorUserId);
  if (!actor || actor.role !== 'ADMIN') throw new TeamError('Only a team admin can remove members', 403);

  const target = await prisma.teamMember.findUnique({ where: { id: input.membershipId } });
  if (!target || target.teamId !== input.teamId) throw new TeamError('That member is not part of this team', 404);

  const result = await prisma.$transaction(async (tx) => {
    const activeAdmins = await tx.teamMember.count({ where: { teamId: input.teamId, role: 'ADMIN', active: true } });
    if (target.role === 'ADMIN' && activeAdmins <= 1) {
      throw new TeamError('A team needs at least one admin. Promote another member first.', 409);
    }
    return tx.teamMember.update({
      where: { id: target.id },
      data: { active: false, removedAt: new Date(), role: 'MEMBER' },
    });
  }, { isolationLevel: 'Serializable' });

  // Documents the removed member authored stay in the team workspace with their attribution
  // intact; only the team-derived access disappears, which is what the next request re-derives.
  const authored = await prisma.document.count({ where: { userId: target.userId, workspace: { teamId: input.teamId } } });
  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: 'team.member.remove',
    teamId: input.teamId,
    targetUserId: target.userId,
    metadata: { role: target.role, retainedAuthoredDocuments: authored, byAppAdmin: actor.isAppAdmin },
  });
  return { removed: true, retainedAuthoredDocuments: authored };
}

export async function setTeamMemberRole(input: { actorUserId: string; teamId: string; membershipId: string; role: 'ADMIN' | 'MEMBER' }) {
  const actor = await resolveTeamActor(input.teamId, input.actorUserId);
  if (!actor || actor.role !== 'ADMIN') throw new TeamError('Only a team admin can change roles', 403);
  const target = await prisma.teamMember.findUnique({ where: { id: input.membershipId } });
  if (!target || target.teamId !== input.teamId) throw new TeamError('That member is not part of this team', 404);

  if (input.role === 'MEMBER' && target.role === 'ADMIN') {
    const admins = await prisma.teamMember.count({ where: { teamId: input.teamId, role: 'ADMIN', active: true } });
    if (admins <= 1) throw new TeamError('A team needs at least one admin', 409);
  }
  const updated = await prisma.teamMember.update({ where: { id: target.id }, data: { role: input.role } });
  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: 'team.member.role',
    teamId: input.teamId,
    targetUserId: target.userId,
    metadata: { from: target.role, to: input.role },
  });
  return { role: updated.role };
}

export { InvitationError };
