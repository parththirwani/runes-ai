// Prisma delegates for route tests whose fixture world is one author-owned document in one
// personal workspace.
//
// Route handlers now go through src/lib/document-lookup.ts and src/lib/access.ts instead of
// comparing userId themselves, so a mocked database has to answer the capability queries too
// (workspace, membership, grants) and not just the document row. Keeping that boilerplate here
// means a route test still reads like a route test.
//
// The fixture deliberately contains no teams and no grants: everything inherited resolves to
// nothing, so a test that forgets a delegate fails closed rather than accidentally passing.

import { vi } from 'vitest';

export type MockDocumentRow = {
  id: string;
  userId: string;
  workspaceId?: string;
  title?: string;
  slug?: string;
  format?: string;
  mainFilePath?: string;
  content?: string | null;
};

export type AuthorAccessOptions = {
  /** The signed-in user the mocked withAuth hands to the route. */
  actorUserId: string;
  /** Returns the document under test, or null when the fixture says it does not exist. */
  document: () => MockDocumentRow | null;
  /** Extra email the mocked user record should carry. */
  email?: string;
};

type Where = Record<string, unknown>;

/** Mirrors the handful of Prisma query operators the shared services actually use. */
function matchesValue(value: unknown, condition: unknown): boolean {
  const isOperator =
    condition !== null && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition);
  if (isOperator) {
    const operator = condition as Record<string, unknown>;
    if ('not' in operator) return !matchesValue(value, operator.not);
    if ('in' in operator) return (operator.in as unknown[]).includes(value);
    if ('notNull' in operator) return value !== null && value !== undefined;
    if ('gte' in operator) return Number(value) >= Number(operator.gte);
    if ('lte' in operator) return Number(value) <= Number(operator.lte);
    return false;
  }
  if (value instanceof Date && condition instanceof Date) return value.getTime() === condition.getTime();
  return value === condition;
}

function matchesWhere(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where ?? {}).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((clause) => matchesWhere(row, clause));
    if (key === 'AND') return (condition as Where[]).every((clause) => matchesWhere(row, clause));
    return matchesValue(row[key], condition);
  });
}

function idsIn(where: Where | undefined): string[] {
  const condition = where?.id as { in?: string[] } | undefined;
  return Array.isArray(condition?.in) ? condition.in : [];
}

export function authorAccessDelegates(options: AuthorAccessOptions) {
  const workspaceIdOf = (document: MockDocumentRow) => document.workspaceId ?? 'workspace-' + document.id;
  const row = () => {
    const document = options.document();
    if (!document) return null;
    return {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      title: document.title ?? 'Fixture',
      slug: document.slug ?? document.id,
      format: document.format ?? 'LATEX',
      mainFilePath: document.mainFilePath ?? 'main.tex',
      content: document.content ?? null,
      ...document,
      workspaceId: workspaceIdOf(document),
    };
  };
  const rows = () => {
    const document = row();
    return document ? [document] : [];
  };
  const workspaces = () => {
    const document = row();
    if (!document) return [];
    return [{ id: workspaceIdOf(document), name: 'Personal', kind: 'PERSONAL' as const, ownerUserId: document.userId, teamId: null, isDefault: true, team: null }];
  };
  const person = (id: string) => ({
    id,
    email: options.email ?? id + '@example.test',
    firstName: 'Fixture',
    lastName: null,
    isAdmin: false,
  });

  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const document = row();
        if (where.id === options.actorUserId) return person(options.actorUserId);
        return document && where.id === document.userId ? person(document.userId) : null;
      }),
      findMany: vi.fn(async (input: { where?: Where } = {}) => {
        const document = row();
        const ids = new Set<string>([options.actorUserId, ...(document ? [document.userId] : []), ...idsIn(input.where)]);
        const wanted = idsIn(input.where);
        return Array.from(ids)
          .filter((id) => wanted.length === 0 || wanted.includes(id))
          .map((id) => person(id));
      }),
    },
    workspace: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => workspaces().find((workspace) => workspace.id === where.id) ?? null),
      findFirst: vi.fn(async (input: { where?: Where } = {}) => workspaces().find((workspace) => matchesWhere(workspace as unknown as Record<string, unknown>, input.where ?? {})) ?? null),
      findMany: vi.fn(async (input: { where?: Where } = {}) => workspaces().filter((workspace) => matchesWhere(workspace as unknown as Record<string, unknown>, input.where ?? {}))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { name?: string } }) => {
        const workspace = workspaces().find((item) => item.id === where.id);
        return workspace ? { ...workspace, name: data.name ?? workspace.name } : null;
      }),
    },
    // The fixture world has no shares and no teams, so every inherited path resolves to nothing.
    teamMember: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    workspaceGrant: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    documentGrant: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    document: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows().find((document) => document.id === where.id) ?? null),
      findFirst: vi.fn(async (input: { where?: Where } = {}) => rows().find((document) => matchesWhere(document as unknown as Record<string, unknown>, input.where ?? {})) ?? null),
      findMany: vi.fn(async (input: { where?: Where } = {}) => rows().filter((document) => matchesWhere(document as unknown as Record<string, unknown>, input.where ?? {}))),
      count: vi.fn(async (input: { where?: Where } = {}) => rows().filter((document) => matchesWhere(document as unknown as Record<string, unknown>, input.where ?? {})).length),
    },
  };
}

/**
 * Merges the capability delegates into a route test's existing document mocks without replacing
 * the spies that test already asserts on.
 */
export function withAccess(delegates: ReturnType<typeof authorAccessDelegates>, existingDocument: Record<string, unknown>) {
  return {
    ...delegates,
    document: { ...delegates.document, ...existingDocument },
  };
}
