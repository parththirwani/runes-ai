import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_ASSETS_PER_DOCUMENT, MAX_TOTAL_ASSET_BYTES } from '@/src/lib/markdown-assets';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }, context: unknown) => Promise<Response>) =>
    (req: NextRequest, context: unknown) => handler(req, { user: { id: 'owner' } }, context),
}));
vi.mock('@/src/lib/db', () => ({
  prisma: {
    document: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));


// Capability decisions live in src/__tests__/access-policy.test.ts. This suite is about files
// and routes, so the access service is pinned to the author case it has always described.
vi.mock('@/src/lib/access', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/access')>('@/src/lib/access');
  const { ownerOnlyAccessStub } = await import('@/src/__tests__/helpers/access-stub');
  return { ...actual, ...ownerOnlyAccessStub() };
});
import { POST } from '@/src/app/api/document/[slug]/assets/route';

const context = { params: Promise.resolve({ slug: 'doc' }) };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function upload(name = 'image.png') {
  const form = new FormData();
  form.append('file', new File([png], name, { type: 'image/png' }));
  return new NextRequest('http://localhost/api/document/doc/assets', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: 'd1', format: 'MARKDOWN' });
  mocks.findMany.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({ id: 'a1', path: 'image.png', mediaType: 'image/png', size: png.length });
  mocks.transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({ documentAsset: { findMany: mocks.findMany, upsert: mocks.upsert } }));
});

describe('Markdown asset upload quota', () => {
  it('allows replacement at the count limit and subtracts the old size', async () => {
    mocks.findMany.mockResolvedValue([
      { path: 'image.png', size: MAX_TOTAL_ASSET_BYTES - 1 },
      ...Array.from({ length: MAX_ASSETS_PER_DOCUMENT - 1 }, (_, i) => ({ path: `other-${i}.png`, size: 0 })),
    ]);
    const res = await POST(upload(), context);
    expect(res.status).toBe(201);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });

  it('rejects a new asset when the count limit is reached', async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: MAX_ASSETS_PER_DOCUMENT }, (_, i) => ({ path: `other-${i}.png`, size: 0 })),
    );
    const res = await POST(upload(), context);
    expect(res.status).toBe(409);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects oversized multipart bodies before parsing the form', async () => {
    const req = new NextRequest('http://localhost/api/document/doc/assets', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=fixture',
        'content-length': String(5 * 1024 * 1024 + 64 * 1024 + 1),
      },
      body: 'ignored',
    });
    const res = await POST(req, context);
    expect(res.status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict for a concurrent serializable transaction', async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2034' }));
    const res = await POST(upload(), context);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/retry/i);
  });
});
