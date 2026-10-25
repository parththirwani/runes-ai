// In-memory AccessClient used by the permission-matrix tests. It mirrors the queries
// src/lib/access.ts issues, so a route-level fake cannot drift from real behaviour.

import type { AccessClient, AccessDocument, AccessWorkspace } from '@/src/lib/access';

export type FakeUser = { id: string; email: string; firstName: string | null; lastName: string | null; isAdmin: boolean };
export type FakeWorkspace = AccessWorkspace;
export type FakeDocument = AccessDocument;
export type FakeMembership = { teamId: string; userId: string; role: 'ADMIN' | 'MEMBER'; active: boolean };
export type FakeGrant = { workspaceId?: string; documentId?: string; recipientUserId: string; permission: 'VIEW' | 'EDIT'; acceptedAt: Date | null; revokedAt: Date | null };

export type FakeWorld = {
  users: FakeUser[];
  workspaces: FakeWorkspace[];
  documents: FakeDocument[];
  memberships: FakeMembership[];
  workspaceGrants: FakeGrant[];
  documentGrants: FakeGrant[];
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => row[key] === expected);
}

export function makeAccessClient(world: FakeWorld): AccessClient {
  return {
    user: {
      async findUnique({ where }) {
        const user = world.users.find((row) => row.id === where.id);
        return user ? clone(user) : null;
      },
    },
    document: {
      async findUnique({ where }) {
        const document = world.documents.find((row) => row.id === where.id);
        return document ? clone(document) : null;
      },
      async findMany(input) {
        const where = (input as { where?: Record<string, unknown> }).where ?? {};
        return world.documents
          .filter((row) => matches(row as unknown as Record<string, unknown>, where))
          .slice()
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .map((row) => {
            const copy = clone(row) as AccessDocument & { user?: FakeUser | null };
            const user = world.users.find((candidate) => candidate.id === row.userId);
            copy.user = user ? clone(user) : null;
            return copy;
          });
      },
    },
    workspace: {
      async findUnique({ where }) {
        const workspace = world.workspaces.find((row) => row.id === where.id);
        if (!workspace) return null;
        const team = workspace.teamId ? { id: workspace.teamId, name: workspace.teamId } : null;
        return { ...clone(workspace), team };
      },
    },
    teamMember: {
      async findFirst({ where }) {
        const row = world.memberships.find((member) => matches(member as unknown as Record<string, unknown>, where));
        return row ? { role: row.role, active: row.active } : null;
      },
    },
    workspaceGrant: {
      async findFirst({ where }) {
        const row = world.workspaceGrants.find((grant) => matches(grant as unknown as Record<string, unknown>, where));
        return row ? { permission: row.permission, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt } : null;
      },
    },
    documentGrant: {
      async findFirst({ where }) {
        const row = world.documentGrants.find((grant) => matches(grant as unknown as Record<string, unknown>, where));
        return row ? { permission: row.permission, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt } : null;
      },
    },
  };
}

const now = new Date('2026-10-25T00:00:00.000Z');
const future = new Date('2027-01-01T00:00:00.000Z');

export const actors = {
  authorA: 'user-a',
  viewerB: 'user-b',
  unrelatedC: 'user-c',
  teamAdminD: 'user-d',
  appAdminE: 'user-e',
  removedMemberF: 'user-f',
};

export type WorldOptions = {
  documentGrant?: Partial<FakeGrant> | null;
  workspaceGrant?: Partial<FakeGrant> | null;
  authorRemovedFromTeam?: boolean;
};

/**
 * One baseline world reused by every matrix test:
 *   ws-a-personal  author A's personal workspace, document `doc-a`
 *   ws-team-default team workspace of `team-1`, document `doc-team` authored by A
 *   A is a plain member of team-1, D is its admin, F is a removed member.
 *   E is an app admin with no workspace relationship at all.
 */
export function makeWorld(options: WorldOptions = {}): FakeWorld {
  const world: FakeWorld = {
    users: [
      { id: actors.authorA, email: 'a@example.test', firstName: 'Author', lastName: 'A', isAdmin: false },
      { id: actors.viewerB, email: 'b@example.test', firstName: 'Viewer', lastName: 'B', isAdmin: false },
      { id: actors.unrelatedC, email: 'c@example.test', firstName: 'Unrelated', lastName: 'C', isAdmin: false },
      { id: actors.teamAdminD, email: 'd@example.test', firstName: 'Team', lastName: 'Admin', isAdmin: false },
      { id: actors.appAdminE, email: 'e@example.test', firstName: 'App', lastName: 'Admin', isAdmin: true },
      { id: actors.removedMemberF, email: 'f@example.test', firstName: 'Removed', lastName: 'F', isAdmin: false },
    ],
    workspaces: [
      { id: 'ws-a-personal', name: 'Personal', kind: 'PERSONAL', ownerUserId: actors.authorA, teamId: null, isDefault: true },
      { id: 'ws-b-personal', name: 'Personal', kind: 'PERSONAL', ownerUserId: actors.viewerB, teamId: null, isDefault: true },
      { id: 'ws-team-default', name: 'Research', kind: 'TEAM', ownerUserId: null, teamId: 'team-1', isDefault: true },
    ],
    documents: [
      { id: 'doc-a', title: 'Thesis', slug: 'thesis', format: 'LATEX', mainFilePath: 'main.tex', content: 'body', userId: actors.authorA, workspaceId: 'ws-a-personal', createdAt: now, updatedAt: now },
      { id: 'doc-team', title: 'Team paper', slug: 'team-paper', format: 'LATEX', mainFilePath: 'main.tex', content: 'team body', userId: actors.authorA, workspaceId: 'ws-team-default', createdAt: now, updatedAt: now },
      { id: 'doc-team-d', title: 'Admin notes', slug: 'admin-notes', format: 'MARKDOWN', mainFilePath: 'main.md', content: 'd body', userId: actors.teamAdminD, workspaceId: 'ws-team-default', createdAt: now, updatedAt: now },
    ],
    memberships: [
      { teamId: 'team-1', userId: actors.authorA, role: 'MEMBER', active: true },
      { teamId: 'team-1', userId: actors.teamAdminD, role: 'ADMIN', active: true },
      { teamId: 'team-1', userId: actors.removedMemberF, role: 'MEMBER', active: false },
    ],
    workspaceGrants: [],
    documentGrants: [],
  };

  if (options.documentGrant) {
    world.documentGrants.push({
      documentId: 'doc-a',
      recipientUserId: actors.viewerB,
      permission: 'VIEW',
      acceptedAt: now,
      revokedAt: null,
      ...options.documentGrant,
    });
  }
  if (options.workspaceGrant) {
    world.workspaceGrants.push({
      workspaceId: 'ws-a-personal',
      recipientUserId: actors.viewerB,
      permission: 'VIEW',
      acceptedAt: now,
      revokedAt: null,
      ...options.workspaceGrant,
    });
  }
  if (options.authorRemovedFromTeam) {
    const membership = world.memberships.find((row) => row.userId === actors.authorA);
    if (membership) membership.active = false;
  }
  return world;
}

export const dates = { now, future };
