import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  doc: { id: 'doc1', format: 'MARKDOWN' } as { id: string; format: string },
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

function request(body: unknown) {
  return new NextRequest('http://localhost/api/ai/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.doc = { id: 'doc1', format: 'MARKDOWN' };
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? Promise.resolve(mocks.doc) : Promise.resolve(null));
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
  mocks.slot.mockResolvedValue(async () => {});
  process.env.OPENROUTER_API_KEY = 'test-key';
});

describe('Markdown paraphrase route', () => {
  const body = {
    documentId: 'doc1',
    selectedText: 'The value is `x + 1` and links to [the docs](https://md.dev) clearly.',
    before: '\n\n', after: '\n\n', tone: 'Clearer',
  };

  it('masks Markdown protected syntax before the provider call and restores it exactly', async () => {
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'The value is @@PROTECTED_1__ and it links to @@PROTECTED_0__ clearly.' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', provider);
    const res = await paraphrase(request(body), {} as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.replacementText).toBe('The value is `x + 1` and it links to [the docs](https://md.dev) clearly.');
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('@@PROTECTED_');
    expect(sent.messages[1].content).not.toContain('https://md.dev');
    expect(sent.messages[0].content).toContain('Markdown');
  });

  it('refuses a response that drops a protected token (URL cannot change)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'The value is @@PROTECTED_1__ and links clearly.' } }],
    }), { status: 200 })));
    const res = await paraphrase(request(body), {} as never);
    expect(res.status).toBe(422);
  });

  it('refuses a response that introduces raw HTML or new URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'See <a href="http://evil">@@PROTECTED_0__ and @@PROTECTED_1__.</a>' } }],
    }), { status: 200 })));
    const res = await paraphrase(request(body), {} as never);
    expect(res.status).toBe(422);
  });

  it('rejects structural selections before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const res = await paraphrase(request({ ...body, selectedText: '# Heading text' }), {} as never);
    expect(res.status).toBe(422);
    expect(provider).not.toHaveBeenCalled();

    const inCode = await paraphrase(request({
      ...body,
      selectedText: 'x = 1',
      before: '\n```python\n',
      after: '\n```\n',
    }), {} as never);
    expect(inCode.status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });

  it('still routes LaTeX documents through the LaTeX rules', async () => {
    mocks.doc = { id: 'doc1', format: 'LATEX' };
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'A result @@PROTECTED_0__ stays.' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', provider);
    const res = await paraphrase(request({
      documentId: 'doc1', selectedText: 'A result \\cite{key} holds.',
      before: ' ', after: ' ', tone: 'Clearer',
    }), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).replacementText).toBe('A result \\cite{key} stays.');
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain('LaTeX');
  });

  it('returns 404 for a document the user does not own', async () => {
    mocks.userId = 'intruder';
    const res = await paraphrase(request(body), {} as never);
    expect(res.status).toBe(404);
  });
});

describe('Markdown completion route', () => {
  it('suppresses suggestions when the caret is inside protected Markdown syntax', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const res = await complete(request({
      documentId: 'doc1',
      prefix: 'text\n```python\nx = ',
      suffix: '\n```\n',
    }), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).insertion).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('suppresses suggestions on structural lines even if the client asks', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const res = await complete(request({ documentId: 'doc1', prefix: '# Title ', suffix: '\n' }), {} as never);
    expect((await res.json()).insertion).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('filters provider output that contains Markdown syntax', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '## a new heading' } }],
    }), { status: 200 })));
    const res = await complete(request({ documentId: 'doc1', prefix: 'Some prose ends ', suffix: ' here.' }), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).insertion).toBeNull();
  });

  it('returns prose-only insertions for eligible Markdown prose', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'and the results were consistent.' } }],
    }), { status: 200 })));
    const res = await complete(request({ documentId: 'doc1', prefix: 'We ran the trial, ', suffix: ' next.' }), {} as never);
    expect((await res.json()).insertion).toBe('and the results were consistent.');
  });
});
