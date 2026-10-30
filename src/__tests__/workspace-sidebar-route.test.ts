import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ listWorkspaces: vi.fn(), findMany: vi.fn(), getAppAdminUser: vi.fn() }));
vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (request: NextRequest, session: { user: { id: string } }) => Promise<Response>) =>
    (request: NextRequest) => handler(request, { user: { id: 'reader' } }),
}));
vi.mock('@/src/lib/workspaces', () => ({ listAccessibleWorkspaces: mocks.listWorkspaces }));
vi.mock('@/src/lib/access', () => ({ getAppAdminUser: mocks.getAppAdminUser }));
vi.mock('@/src/lib/db', () => ({ prisma: { document: { findMany: mocks.findMany } } }));

import { GET } from '@/src/app/api/workspaces/route';

describe('GET /api/workspaces sidebar payload', () => {
  it('lists document titles only inside workspaces the caller can read, without source content', async () => {
    mocks.getAppAdminUser.mockResolvedValue(null);
    mocks.listWorkspaces.mockResolvedValue([
      { id: 'owned', name: 'Research' },
      { id: 'shared', name: 'Shared notes' },
    ]);
    mocks.findMany.mockResolvedValue([
      { id: 'doc-1', title: 'Outline', workspaceId: 'owned', updatedAt: new Date('2026-10-25') },
    ]);
    const response = await GET(new NextRequest('http://localhost/api/workspaces'), {} as never);
    expect(response.status).toBe(200);
    expect(mocks.listWorkspaces).toHaveBeenCalledWith('reader');
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { workspaceId: { in: ['owned', 'shared'] } },
      select: { id: true, title: true, workspaceId: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).not.toHaveProperty('content');
    expect(body.canCreateTeams).toBe(false);
  });

  it('marks the team creation entry point only for an app admin', async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);
    mocks.getAppAdminUser.mockResolvedValue({ id: 'reader' });
    const response = await GET(new NextRequest('http://localhost/api/workspaces'), {} as never);
    expect((await response.json()).canCreateTeams).toBe(true);
  });
});
