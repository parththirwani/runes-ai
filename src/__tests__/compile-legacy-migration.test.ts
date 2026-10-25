import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const document = {
    id: 'legacy-md',
    slug: 'legacy-md',
    userId: 'owner',
    format: 'MARKDOWN' as const,
    content: '# Legacy source',
    mainFilePath: 'main.tex',
  };
  const files: Array<{ documentId: string; path: string; content: string; checksum: string; revision: number }> = [];
  return { document, files, addJob: vi.fn(), rateLimit: vi.fn() };
});

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }, context: unknown) => Promise<Response>) =>
    (req: NextRequest, context: unknown) => handler(req, { user: { id: 'owner' } }, context),
}));
vi.mock('@/src/lib/db', async () => {
  const { authorAccessDelegates, withAccess } = await import('@/src/__tests__/helpers/prisma-access-mock');
  // Compiling re-derives authorship through the shared authorization service before queueing.
  const access = authorAccessDelegates({ actorUserId: 'owner', document: () => ({ ...mocks.document, workspaceId: 'workspace-1' }) });
  return {
  prisma: {
    ...withAccess(access, {}),
    document: {
      findFirst: vi.fn(async () => ({ ...mocks.document, workspaceId: 'workspace-1' })),
      findUnique: vi.fn(async () => ({ ...mocks.document, workspaceId: 'workspace-1' })),
      update: vi.fn(async ({ data }: { data: { mainFilePath: string } }) => {
        mocks.document.mainFilePath = data.mainFilePath;
        return { ...mocks.document };
      }),
    },
    workspaceFile: {
      count: vi.fn(async () => mocks.files.length),
      create: vi.fn(async ({ data }: { data: (typeof mocks.files)[number] }) => {
        const file = { ...data };
        mocks.files.push(file);
        return file;
      }),
      findUnique: vi.fn(async ({ where }: { where: { documentId_path: { documentId: string; path: string } } }) =>
        mocks.files.find((file) => file.documentId === where.documentId_path.documentId && file.path === where.documentId_path.path) ?? null),
    },
    documentAsset: { findMany: vi.fn(async () => []) },
  },
  };
});
vi.mock('@/producer/queue', () => ({ compilationProducer: { addJob: mocks.addJob } }));
vi.mock('@/src/lib/rateLimit', () => ({ checkRateLimit: mocks.rateLimit }));

import { POST } from '@/src/app/api/document/[slug]/route';

beforeEach(() => {
  mocks.document.mainFilePath = 'main.tex';
  mocks.files.length = 0;
  mocks.addJob.mockReset().mockResolvedValue('job-md');
  mocks.rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
});

describe('compile after lazy migration', () => {
  it('queues the migrated Markdown main file on first compile', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/document/legacy-md', { method: 'POST' }),
      { params: Promise.resolve({ slug: 'legacy-md' }) },
    );

    expect(response.status).toBe(202);
    expect(mocks.files).toHaveLength(1);
    expect(mocks.files[0].path).toBe('main.md');
    expect(mocks.addJob).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'legacy-md',
      content: '# Legacy source',
      format: 'MARKDOWN',
    }));
    expect((await response.json()).snapshot.mainFile).toBe('main.md');
  });
});
