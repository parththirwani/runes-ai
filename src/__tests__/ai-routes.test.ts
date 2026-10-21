import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  findFirst: vi.fn(),
  limit: vi.fn(),
  slot: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { user: { id: mocks.userId } }),
}));
vi.mock('@/src/lib/db', () => ({ prisma: { document: { findFirst: mocks.findFirst } } }));
vi.mock('@/src/lib/ai-rate-limit', () => ({ checkAiRateLimit: mocks.limit, acquireAiSlot: mocks.slot }));

import { POST as paraphrase } from '@/src/app/api/ai/paraphrase/route';
import { POST as complete } from '@/src/app/api/ai/complete/route';

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const paraphraseBody = {
  documentId: 'doc1', selectedText: 'A result \\cite{key} is useful.',
  before: ' ', after: ' ', tone: 'Clearer',
};
const completionBody = { documentId: 'doc1', prefix: 'A result', suffix: ' follows.', requestId: '1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? { id: 'doc1' } : null);
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
  mocks.slot.mockResolvedValue(async () => {});
  process.env.OPENROUTER_API_KEY = 'test-key';
});

describe('AI routes', () => {
  it('rejects invalid and wrong-owner paraphrase requests before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    expect((await paraphrase(request('/api/ai/paraphrase', { ...paraphraseBody, selectedText: '' }) as never, {} as never)).status).toBe(400);
    mocks.userId = 'other';
    expect((await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never)).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it('masks protected LaTeX before the provider call and restores exact bytes', async () => {
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'The result @@PROTECTED_0__ is useful.' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', provider);
    const response = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect((await response.json()).replacementText).toBe('The result \\cite{key} is useful.');
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('@@PROTECTED_0__');
    expect(sent.messages[1].content).not.toContain('A result \\cite{key} is useful.');
  });

  it('rejects a model response that drops a protected token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'The result is useful.' } }],
    }), { status: 200 })));
    const response = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(response.status).toBe(422);
  });

  it('returns a quota response before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 13 });
    const response = await complete(request('/api/ai/complete', completionBody) as never, {} as never);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('13');
    expect(provider).not.toHaveBeenCalled();
  });

  it('allows only one concurrent paraphrase provider call per user', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    mocks.slot.mockResolvedValue(null);
    const response = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(response.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects malformed completion output without changing a document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '\\input{other}' } }],
    }), { status: 200 })));
    const response = await complete(request('/api/ai/complete', completionBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect((await response.json()).insertion).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'doc1', userId: 'owner' }, select: { id: true } });
  });

  it('rejects another user for completion', async () => {
    mocks.userId = 'other';
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const response = await complete(request('/api/ai/complete', completionBody) as never, {} as never);
    expect(response.status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps completion quiet and reports paraphrase unavailable without a provider key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const completion = await complete(request('/api/ai/complete', completionBody) as never, {} as never);
    expect(completion.status).toBe(503);
    expect((await completion.json()).insertion).toBeNull();
    const paraphraseResult = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(paraphraseResult.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not expose source text from a provider failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private source text', { status: 500 })));
    const response = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private source text');
    expect(logged.mock.calls.flat().join(' ')).not.toContain('private source text');
    logged.mockRestore();
  });

  it('bounds a stalled paraphrase provider request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    const response = await paraphrase(request('/api/ai/paraphrase', paraphraseBody) as never, {} as never);
    expect(response.status).toBe(504);
  });
});
