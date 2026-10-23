import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { user: { id: 'owner' } }),
}));
vi.mock('@/src/lib/db', () => ({ prisma: { document: { findFirst: mocks.findFirst } } }));
vi.mock('@/src/lib/openrouter', () => ({ ChatCompletion: mocks.complete }));

import { POST } from '@/src/app/api/chat/route';

const documentId = '5c367a11-3827-43fc-93bd-9d4e59c4e9f3';
function request(body: string) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: documentId, title: 'Test', content: 'Source', mainFilePath: null });
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => { delete process.env.OPENROUTER_API_KEY; });

describe('chat route', () => {
  it('reports a missing provider after verifying document ownership', async () => {
    const response = await POST(request(JSON.stringify({ documentId, message: 'Improve this' })) as never, {} as never);
    expect(response.status).toBe(503);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: documentId, userId: 'owner' },
      select: { id: true, title: true, content: true, mainFilePath: true },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('keeps another user document hidden when the provider is unavailable', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(request(JSON.stringify({ documentId, message: 'Improve this' })) as never, {} as never);
    expect(response.status).toBe(404);
  });

  it('rejects malformed JSON without calling the provider', async () => {
    const response = await POST(request('{') as never, {} as never);
    expect(response.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
