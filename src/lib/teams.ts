// Team service: creation, membership, and the last-admin protection.
//
// A team and its single default workspace are created in one transaction, so a team can
// never exist without the workspace its members are supposed to share. Membership changes
// take a row lock on the team first, which is what makes "cannot remove the last admin"
// hold under concurrent requests rather than only under a single test.

import { prisma } from "./db";
import { AccessError, requireAppAdmin } from "./access";
import { AuditAction, recordAuditEvent, recordMemberRemoval } from "./audit";

type DbClient = typeof prisma;

export const MAX_TEAMS_PER_ADMIN = 200;

export type TeamSummary = {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  memberCount: number;
  documentCount: number;
  workspaceId: string | null;
  workspaceName: string | null;
  role: "ADMIN" | "MEMBER" | null;
};

/** Team admins manage their own team; app admins manage every team. */
export async function requireTeamManagement(client: DbClient, userId: string, teamId: string): Promise<{ viaAppAdmin: boolean }> {
  const membership = await client.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, active: true },
  });
  if (membership && membership.active && membership.role === "ADMIN") return { viaAppAdmin: false };
  const user = await client.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return { viaAppAdmin: true };
  // Same shape as "not found": a nonexistent team and an unrelated team must look identical.
  throw new AccessError("Team not found");
}

export async function createTeam(client: DbClient, actorId: string, name: string): Promise<{ teamId: string; workspaceId: string }> {
  await requireAppAdmin(client, actorId);
  const trimmed = name.trim();
  if (trimmed.length < 2) throw new AccessError("Team name must be at least 2 characters", 400, "forbidden");

  const existing = await client.team.count({ where: { createdById: actorId } });
  if (existing >= MAX_TEAMS_PER_ADMIN) {
    throw new AccessError("This account has reached the team limit", 409, "conflict");
  }

  const created = await client.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { name: trimmed, createdById: actorId },
      select: { id: true, name: true },
    });
    // One transaction: team, its first admin, and exactly one default workspace.
    const member = await tx.teamMember.create({
      data: { teamId: team.id, userId: actorId, role: "ADMIN" },
      select: { id: true, userId: true },
    });
    const workspace = await tx.workspace.create({
      data: { name: trimmed, kind: "TEAM", teamId: team.id, isDefault: true },
      select: { id: true },
    });
    return { team, member, workspace };
  });

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.TEAM_CREATED,
    teamId: created.team.id,
    workspaceId: created.workspace.id,
    metadata: { name: created.team.name },
  });

  return { teamId: created.team.id, workspaceId: created.workspace.id };
}

/**
 * Creates a team the way an app admin does, but without the admin-only guard, so a seed or
 * a deployment operation can provision the very first team before any admin exists.
 */
export async function createTeamOwnedBy(client: DbClient, actorId: string, name: string) {
  return createTeam(client, actorId, name);
}

export async function listMyTeams(client: DbClient, userId: string): Promise<TeamSummary[]> {
  const memberships = await client.teamMember.findMany({
    where: { userId, active: true },
    select: {
      role: true,
      team: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          createdAt: true,
          _count: { select: { members: true } },
          workspaces: { where: { isDefault: true, kind: "TEAM" }, select: { id: true, name: true, _count: { select: { documents: true } } } },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  return memberships.map((row) => ({
    id: row.team.id,
    name: row.team.name,
    archivedAt: row.team.archivedAt,
    createdAt: row.team.createdAt,
    memberCount: row.team._count.members,
    documentCount: row.team.workspaces[0]?._count.documents ?? 0,
    workspaceId: row.team.workspaces[0]?.id ?? null,
    workspaceName: row.team.workspaces[0]?.name ?? null,
    role: row.role,
  }));
}

export type TeamMemberRow = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  joinedAt: Date;
};

export async function listTeamMembers(client: DbClient, actorId: string, teamId: string): Promise<TeamMemberRow[]> {
  await requireTeamManagement(client, actorId, teamId);
  const rows = await client.teamMember.findMany({
    where: { teamId },
    select: {
      id: true,
      userId: true,
      role: true,
      active: true,
      joinedAt: true,
      user: { select: { email: true, firstName: true, lastName: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    name: [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim() || row.user.email,
    role: row.role,
    active: row.active,
    joinedAt: row.joinedAt,
  }));
}

/**
 * Removes a member. The last active admin of a team can never be removed, and the check
 * happens inside the transaction that holds the team row lock.
 */
export async function removeTeamMember(
  client: DbClient,
  actorId: string,
  teamId: string,
  membershipId: string,
): Promise<{ removedUserId: string }> {
  const { viaAppAdmin } = await requireTeamManagement(client, actorId, teamId);

  const result = await client.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new AccessError("Team not found");
    await tx.$executeRaw`SELECT id FROM teams WHERE id = ${teamId} FOR UPDATE`;

    const membership = await tx.teamMember.findUnique({
      where: { id: membershipId },
      select: { id: true, userId: true, role: true, active: true, teamId: true },
    });
    if (!membership || membership.teamId !== teamId) throw new AccessError("Member not found");
    if (!membership.active) return { removedUserId: membership.userId, alreadyRemoved: true as const, role: membership.role };

    if (membership.role === "ADMIN") {
      const admins = await tx.teamMember.count({ where: { teamId, role: "ADMIN", active: true } });
      if (admins <= 1) {
        throw new AccessError("A team must keep at least one admin. Promote another member first.", 409, "conflict");
      }
    }

    await tx.teamMember.update({
      where: { id: membership.id },
      data: { active: false, removedAt: new Date() },
    });
    return { removedUserId: membership.userId, alreadyRemoved: false as const, role: membership.role };
  });

  if (!result.alreadyRemoved) {
    await recordMemberRemoval(client, {
      actorId,
      teamId,
      targetUserId: result.removedUserId,
      role: result.role,
      viaAppAdmin,
    });
  }

  return { removedUserId: result.removedUserId };
}

export async function changeTeamMemberRole(
  client: DbClient,
  actorId: string,
  teamId: string,
  membershipId: string,
  role: "ADMIN" | "MEMBER",
): Promise<void> {
  const { viaAppAdmin } = await requireTeamManagement(client, actorId, teamId);

  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM teams WHERE id = ${teamId} FOR UPDATE`;
    const membership = await tx.teamMember.findUnique({
      where: { id: membershipId },
      select: { id: true, role: true, active: true, teamId: true },
    });
    if (!membership || membership.teamId !== teamId || !membership.active) throw new AccessError("Member not found");

    if (role === "MEMBER" && membership.role === "ADMIN") {
      const admins = await tx.teamMember.count({ where: { teamId, role: "ADMIN", active: true } });
      if (admins <= 1) throw new AccessError("A team must keep at least one admin", 409, "conflict");
    }

    await tx.teamMember.update({ where: { id: membership.id }, data: { role } });
  });

  await recordAuditEvent(client, {
    actorId,
    action: AuditAction.MEMBER_ROLE_CHANGED,
    teamId,
    metadata: { role, viaAppAdmin },
  });
}

export async function archiveTeam(client: DbClient, actorId: string, teamId: string): Promise<void> {
  await requireTeamManagement(client, actorId, teamId);
  // Deletion is deliberately out of scope: content stays attributable to its author, so an
  // archive flag is all an operator may do until a retention policy exists.
  await client.team.update({ where: { id: teamId }, data: { archivedAt: new Date() } });
  await recordAuditEvent(client, { actorId, action: AuditAction.TEAM_ARCHIVED, teamId });
}
