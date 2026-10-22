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

import { PATCH, PUT } from '@/src/app/api/document/[slug]/route';

beforeEach(() => {
  mocks.document.title = 'Notes';
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

  it('saves workspace files without a title or legacy content field', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'chapter.md', content: '# Chapter', baseRevision: 3 }] }),
    }), { params: Promise.resolve({ slug: 'legacy-md' }) });

    expect(response.status).toBe(200);
    expect(mocks.writeTextFile).toHaveBeenCalledWith({
      userId: 'owner', slug: 'legacy-md', rawPath: 'chapter.md', content: '# Chapter', baseRevision: 3,
    });
    expect((await response.json()).saved).toEqual([{ path: 'main.md', revision: 2, checksum: 'new' }]);
  });

  it('accepts a title with files and rejects malformed file saves before writing', async () => {
    const context = { params: Promise.resolve({ slug: 'legacy-md' }) };
    const valid = await PUT(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Revised', files: [{ path: 'main.md', content: '# Revised', baseRevision: 1 }] }),
    }), context);
    expect(valid.status).toBe(200);
    expect(mocks.document.title).toBe('Revised');
    expect(mocks.writeTextFile).toHaveBeenCalledTimes(1);

    mocks.writeTextFile.mockClear();
    const invalid = await PUT(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'main.md', content: '# Invalid', baseRevision: -1 }] }),
    }), context);
    expect(invalid.status).toBe(400);
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });
});

describe('PATCH after lazy migration', () => {
  it('writes supplied Markdown content to the migrated main.md path', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Revised', content: '# New' }),
    }), { params: Promise.resolve({ slug: 'legacy-md' }) });

    expect(response.status).toBe(200);
    expect(mocks.files).toEqual(['main.md']);
    expect(mocks.writeTextFile).toHaveBeenCalledWith({
      userId: 'owner', slug: 'legacy-md', rawPath: 'main.md', content: '# New',
    });
    expect(mocks.document.title).toBe('Revised');
  });

  it('does not replace workspace content when changing only the title', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/document/legacy-md', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    }), { params: Promise.resolve({ slug: 'legacy-md' }) });

    expect(response.status).toBe(200);
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.document.title).toBe('Renamed');
    expect(mocks.document.content).toBe('# Old');
  });
});
