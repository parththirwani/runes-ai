import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const document = {
    id: 'legacy-md', slug: 'legacy-md', userId: 'owner', title: 'Notes',
    format: 'MARKDOWN' as const, content: '# Old', mainFilePath: 'main.tex',
  };
  return { document, files: [] as string[], writeTextFile: vi.fn() };
});

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }, context: unknown) => Promise<Response>) =>
    (req: NextRequest, context: unknown) => handler(req, { user: { id: 'owner' } }, context),
}));
vi.mock('@/src/lib/db', () => ({
  prisma: {
    document: {
      findFirst: vi.fn(async () => ({ ...mocks.document })),
      findUnique: vi.fn(async () => ({ ...mocks.document })),
      update: vi.fn(async ({ data }: { data: Partial<typeof mocks.document> }) => {
        Object.assign(mocks.document, data);
        return { ...mocks.document };
      }),
    },
    workspaceFile: {
      count: vi.fn(async () => mocks.files.length),
      create: vi.fn(async ({ data }: { data: { path: string } }) => {
        mocks.files.push(data.path);
        return data;
      }),
    },
  },
}));
vi.mock('@/src/lib/workspace-files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/workspace-files')>();
  return { ...actual, writeTextFile: mocks.writeTextFile };
});

import { PUT } from '@/src/app/api/document/[slug]/route';

beforeEach(() => {
  mocks.document.mainFilePath = 'main.tex';
  mocks.document.content = '# Old';
  mocks.files.length = 0;
  mocks.writeTextFile.mockReset().mockResolvedValue({
    file: { path: 'main.md', revision: 2, checksum: 'new' }, created: false, unchanged: false,
  });
});

describe('PUT after lazy migration', () => {
  it('saves legacy Markdown content to the migrated main.md path', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# New' }),
    }), { params: Promise.resolve({ slug: 'legacy-md' }) });

    expect(response.status).toBe(200);
    expect(mocks.files).toEqual(['main.md']);
    expect(mocks.writeTextFile).toHaveBeenCalledWith({
      userId: 'owner', slug: 'legacy-md', rawPath: 'main.md', content: '# New',
    });
    expect((await response.json()).saved).toEqual([{ path: 'main.md', revision: 2, checksum: 'new' }]);
  });
});
