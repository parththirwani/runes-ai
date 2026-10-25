import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  addJob: vi.fn(),
  rateLimit: vi.fn(),
  findDefaultWorkspace: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }, context: unknown) => Promise<Response>) =>
    (req: NextRequest, context: unknown) => handler(req, { user: { id: mocks.userId } }, context),
}));
vi.mock('@/src/lib/db', () => ({
  prisma: {
    document: {
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      // The capability check resolves the document, then the route reads the stored row, which
      // is where format and content come from. Each fixture below describes one document, so
      // the same row answers both lookups.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = await mocks.findFirst({ where: { id: where.id } });
        return row && row.id === where.id ? row : null;
      }),
      update: mocks.update,
      delete: mocks.delete,
    },
    documentAsset: { findMany: vi.fn().mockResolvedValue([]) },
    // Documents now live in a collection workspace; creation resolves the author's default.
    workspace: { findFirst: mocks.findDefaultWorkspace, create: vi.fn() },
  },
}));
vi.mock('@/producer/queue', () => ({ compilationProducer: { addJob: mocks.addJob } }));
vi.mock('@/src/lib/rateLimit', () => ({ checkRateLimit: mocks.rateLimit }));

// Capability decisions live in src/__tests__/access-policy.test.ts. This suite is about files
// and routes, so the access service is pinned to the author case it has always described.
vi.mock('@/src/lib/access', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/access')>('@/src/lib/access');
  const { ownerOnlyAccessStub } = await import('@/src/__tests__/helpers/access-stub');
  return { ...actual, ...ownerOnlyAccessStub() };
});

import { POST as createDocument, GET as listDocuments } from '@/src/app/api/document/route';
import { POST as compileDocument, PUT as updateDocument } from '@/src/app/api/document/[slug]/route';

const context = { params: Promise.resolve({ slug: 'my-doc' }) };

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  mocks.findDefaultWorkspace.mockResolvedValue({ id: 'ws-default' });
});

describe('POST /api/document (creation)', () => {
  it('creates a Markdown document with the Markdown template and stored format', async () => {
    mocks.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'd1', ...data }));
    const res = await createDocument(jsonRequest('/api/document', { title: 'Notes', format: 'MARKDOWN' }), {} as never);
    expect(res.status).toBe(201);
    const body = mocks.create.mock.calls[0][0].data;
    expect(body.format).toBe('MARKDOWN');
    expect(body.workspaceId).toBe('ws-default');
    expect(body.content.startsWith('# Notes')).toBe(true);
    expect(body.content).not.toContain('\\documentclass');
  });

  it('creates a LaTeX document with the TeX template', async () => {
    mocks.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'd2', ...data }));
    await createDocument(jsonRequest('/api/document', { title: 'Paper', format: 'LATEX' }), {} as never);
    const body = mocks.create.mock.calls[0][0].data;
    expect(body.format).toBe('LATEX');
    expect(body.content).toContain('\\documentclass{article}');
  });

  it('defaults a missing format to LATEX for legacy clients and rejects invalid formats', async () => {
    mocks.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'd3', ...data }));
    await createDocument(jsonRequest('/api/document', { title: 'Legacy' }), {} as never);
    expect(mocks.create.mock.calls[0][0].data.format).toBe('LATEX');

    const bad = await createDocument(jsonRequest('/api/document', { title: 'Bad', format: 'PDF' }), {} as never);
    expect(bad.status).toBe(400);
  });

  it('returns 409 for a duplicate title (unique constraint)', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await createDocument(jsonRequest('/api/document', { title: 'Notes', format: 'MARKDOWN' }), {} as never);
    expect(res.status).toBe(409);
  });
});

describe('GET /api/document (dashboard list)', () => {
  it('returns format and plain-text excerpts per format', async () => {
    const author = { id: 'owner', email: 'owner@example.com', firstName: 'Own', lastName: 'Er', image: null };
    const workspace = { id: 'ws-default', name: 'My documents', kind: 'PERSONAL' };
    mocks.findMany.mockResolvedValue([
      {
        id: '1', title: 'Md', slug: 'md', content: '# Head\n\n**bold** text', format: 'MARKDOWN',
        isFavorite: false, createdAt: '', updatedAt: '', userId: 'owner', workspaceId: 'ws-default', workspace, user: author,
      },
      {
        id: '2', title: 'Tex', slug: 'tex', content: '\\section{Intro}\nHello world', format: 'LATEX',
        isFavorite: false, createdAt: '', updatedAt: '', userId: 'owner', workspaceId: 'ws-default', workspace, user: author,
      },
    ]);
    const res = await listDocuments(new NextRequest('http://localhost/api/document'), {} as never);
    const data = await res.json();
    const md = data.documents.find((d: { slug: string }) => d.slug === 'md');
    const tex = data.documents.find((d: { slug: string }) => d.slug === 'tex');
    expect(md.format).toBe('MARKDOWN');
    expect(md.excerpt).toContain('bold');
    expect(md.excerpt).not.toContain('#');
    expect(tex.excerpt).toContain('Hello world');
    expect(tex.excerpt).not.toContain('\\section');
  });
});

describe('PUT /api/document/[slug] (updates)', () => {
  it('accepts title/content updates', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'd1', slug: 'my-doc', format: 'MARKDOWN', content: 'x' });
    mocks.update.mockResolvedValue({ id: 'd1' });
    const req = new NextRequest('http://localhost/api/document/my-doc', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Renamed' }),
    });
    const res = await updateDocument(req, context);
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.title).toBe('Renamed');
  });

  it('rejects any attempt to change format through updates', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'd1', slug: 'my-doc', format: 'LATEX', content: 'x' });
    const req = new NextRequest('http://localhost/api/document/my-doc', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'MARKDOWN' }),
    });
    const res = await updateDocument(req, context);
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/document/[slug] (compile dispatch)', () => {
  it('derives LATEX from the owned row and enqueues without assets', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'd1', slug: 'my-doc', title: 'Tex', content: '\\begin{document}', format: 'LATEX', userId: 'owner' });
    mocks.addJob.mockResolvedValue('job-1');
    const res = await compileDocument(new NextRequest('http://localhost/api/document/my-doc', { method: 'POST' }), context);
    expect(res.status).toBe(202);
    const job = mocks.addJob.mock.calls[0][0];
    expect(job.format).toBe('LATEX');
    expect(job.assets).toBeUndefined();
  });

  it('derives MARKDOWN from the owned row and embeds asset snapshots', async () => {
    const { prisma } = await import('@/src/lib/db');
    mocks.findFirst.mockResolvedValue({ id: 'd2', slug: 'my-doc', title: 'Md', content: '# Hi', format: 'MARKDOWN', userId: 'owner' });
    (prisma.documentAsset as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn().mockResolvedValue([
      { path: 'images/a.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    mocks.addJob.mockResolvedValue('job-2');
    const res = await compileDocument(new NextRequest('http://localhost/api/document/my-doc', { method: 'POST' }), context);
    expect(res.status).toBe(202);
    const job = mocks.addJob.mock.calls[0][0];
    expect(job.format).toBe('MARKDOWN');
    expect(job.assets).toEqual([{ path: 'images/a.png', mediaType: 'image/png', data: 'AQID' }]);
  });

  it('never leaks internal errors or source into the response body on queue failure', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'd3', slug: 'my-doc', title: 'Md', content: 'secret source', format: 'MARKDOWN', userId: 'owner' });
    const { prisma } = await import('@/src/lib/db');
    (prisma.documentAsset as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn().mockRejectedValue(new Error('db connection string secret'));
    mocks.addJob.mockResolvedValue('unused');
    const res = await compileDocument(new NextRequest('http://localhost/api/document/my-doc', { method: 'POST' }), context);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain('secret source');
    expect(body).not.toContain('connection string');
  });
});
