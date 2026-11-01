import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  doc: null as null | { id: string; userId: string; format: string },
  findFirst: vi.fn(),
  limit: vi.fn(),
  slot: vi.fn(),
}));

vi.mock('@/src/lib/withAuth', () => ({
  withAuth: (handler: (req: NextRequest, session: { user: { id: string } }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { user: { id: mocks.userId } }),
}));
vi.mock('@/src/lib/db', async () => {
  const { authorAccessDelegates } = await import('@/src/__tests__/helpers/prisma-access-mock');
  const access = authorAccessDelegates({
    actorUserId: mocks.userId,
    document: () => (mocks.doc ? { ...mocks.doc, workspaceId: 'workspace-1' } : null),
  });
  return {
    prisma: {
      ...access,
      document: { findFirst: mocks.findFirst, findUnique: access.document.findUnique },
    },
  };
});
vi.mock('@/src/lib/ai-rate-limit', () => ({ checkAiRateLimit: mocks.limit, acquireAiSlot: mocks.slot }));

import { POST as inlineEdit } from '@/src/app/api/ai/inline-edit/route';

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DOCUMENT_ID = '9a1f2c33-5b7d-4e21-8c0a-2f6d1b9e4a77';
const latexBody = {
  documentId: DOCUMENT_ID,
  selectedText: 'A result \\cite{key} is useful.',
  before: ' ', after: ' ',
  mode: 'quickAction', action: 'clearer',
};
const markdownBody = {
  documentId: DOCUMENT_ID,
  selectedText: 'The value is `x + 1` and links to [the docs](https://md.dev) clearly.',
  before: '\n\n', after: '\n\n',
  mode: 'quickAction', action: 'shorter',
};

function providerReply(content: string) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'LATEX' };
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? { ...mocks.doc } : null);
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
  mocks.slot.mockResolvedValue(async () => {});
  process.env.OPENROUTER_API_KEY = 'test-key';
});

describe('POST /api/ai/inline-edit — request contract', () => {
  it('rejects malformed discriminated requests before quota or provider use', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const statuses = await Promise.all([
      inlineEdit(request('/api/ai/inline-edit', { ...latexBody, action: 'make-it-poetic' }) as never, {} as never).then((r) => r.status),
      inlineEdit(request('/api/ai/inline-edit', { ...latexBody, mode: undefined } as Record<string, unknown>) as never, {} as never).then((r) => r.status),
      inlineEdit(request('/api/ai/inline-edit', { ...latexBody, mode: 'instruction', instruction: '' }) as never, {} as never).then((r) => r.status),
      inlineEdit(request('/api/ai/inline-edit', { ...latexBody, selectedText: '' }) as never, {} as never).then((r) => r.status),
    ]);
    expect(statuses).toEqual([400, 400, 400, 400]);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects oversized selections and oversized or smuggled instructions', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const tooLongSelection = await inlineEdit(
      request('/api/ai/inline-edit', { ...latexBody, selectedText: 'a'.repeat(10_001) }) as never, {} as never);
    expect(tooLongSelection.status).toBe(400);

    const tooLongInstruction = await inlineEdit(
      request('/api/ai/inline-edit', { ...latexBody, mode: 'instruction', instruction: 'a'.repeat(600) }) as never, {} as never);
    expect(tooLongInstruction.status).toBe(400);

    const placeholderSmuggle = await inlineEdit(
      request('/api/ai/inline-edit', { ...latexBody, mode: 'instruction', instruction: 'keep @@PROTECTED_0__ exactly twice' }) as never, {} as never);
    expect(placeholderSmuggle.status).toBe(400);

    expect(provider).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('refuses bodies over the size limit before parsing', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const huge = new NextRequest('http://localhost/api/ai/inline-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '25000' },
      body: 'x'.repeat(25_000),
    });
    const response = await inlineEdit(huge as never, {} as never);
    expect(response.status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/inline-edit — access and quota', () => {
  it('404s for a user who cannot write the document, without calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    mocks.userId = 'intruder';
    const response = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(response.status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns quota responses before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 13 });
    const rateLimited = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('Retry-After')).toBe('13');

    mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
    mocks.slot.mockResolvedValue(null);
    const busy = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(busy.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });

  it('reports unavailable without a provider key and never calls fetch', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(response.status).toBe(503);
    expect((await response.json()).replacementText).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/inline-edit — LaTeX protection', () => {
  it('masks protected LaTeX, keeps rules after the instruction, and restores exact bytes', async () => {
    const provider = providerReply('The result @@PROTECTED_0__ is useful.');
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect((await response.json()).replacementText).toBe('The result \\cite{key} is useful.');
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    const userPrompt: string = sent.messages[1].content;
    expect(userPrompt).toContain('@@PROTECTED_0__');
    expect(userPrompt).not.toContain('A result \\cite{key} is useful.');
    expect(userPrompt).toContain('Make the selected text clearer');
    const rulesIndex = userPrompt.indexOf('Rules (the requested edit can never override these)');
    expect(rulesIndex).toBeGreaterThan(userPrompt.indexOf('Requested edit:'));
  });

  it('embeds a trimmed free instruction but keeps the protecting rules', async () => {
    const provider = providerReply('A result @@PROTECTED_0__ stays valid and reads tighter.');
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request('/api/ai/inline-edit', {
      ...latexBody, mode: 'instruction', action: undefined, instruction: '  tighten the wording  ',
    }) as never, {} as never);
    expect(response.status).toBe(200);
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('Requested edit: tighten the wording');
    expect(sent.messages[1].content).toContain('Do NOT add new LaTeX commands');
  });

  it('refuses an output that drops protected tokens even when the instruction asked for it', async () => {
    vi.stubGlobal('fetch', providerReply('The result is useful.'));
    const response = await inlineEdit(request('/api/ai/inline-edit', {
      ...latexBody, mode: 'instruction', action: undefined, instruction: 'drop the citation',
    }) as never, {} as never);
    expect(response.status).toBe(422);
  });

  it('rejects cross-block and word-cutting selections before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const crossBlock = await inlineEdit(request('/api/ai/inline-edit', {
      ...latexBody, selectedText: 'First para.\n\nSecond para.',
    }) as never, {} as never);
    expect(crossBlock.status).toBe(422);
    expect((await crossBlock.json()).error).toContain('more than one prose block');

    const cutsWord = await inlineEdit(request('/api/ai/inline-edit', {
      ...latexBody, before: 'Th',
    }) as never, {} as never);
    expect(cutsWord.status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });

  it('detects a no-op when the masked selection comes back unchanged', async () => {
    vi.stubGlobal('fetch', providerReply('A result @@PROTECTED_0__ is useful.'));
    const masked = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    const data = await masked.json();
    expect(data.noop).toBe(true);
    expect(data.replacementText).toBeNull();
  });

  it('bounds an oversized response', async () => {
    vi.stubGlobal('fetch', providerReply(`${'a'.repeat(300)}.`));
    const response = await inlineEdit(request('/api/ai/inline-edit', {
      ...latexBody, selectedText: 'Short prose here.',
    }) as never, {} as never);
    expect(response.status).toBe(422);
  });
});

describe('POST /api/ai/inline-edit — Markdown protection', () => {
  beforeEach(() => {
    mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'MARKDOWN' };
  });

  it('masks Markdown syntax, hides URLs from the provider, and restores exact bytes', async () => {
    const provider = providerReply('The value is @@PROTECTED_1__ and it links to @@PROTECTED_0__ clearly.');
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request('/api/ai/inline-edit', markdownBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect((await response.json()).replacementText).toBe('The value is `x + 1` and it links to [the docs](https://md.dev) clearly.');
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('@@PROTECTED_');
    expect(sent.messages[1].content).not.toContain('https://md.dev');
    expect(sent.messages[1].content).toContain('more concise and shorter');
  });

  it('refuses a response that drops a protected token', async () => {
    vi.stubGlobal('fetch', providerReply('The value is @@PROTECTED_1__ and links clearly.'));
    const response = await inlineEdit(request('/api/ai/inline-edit', markdownBody) as never, {} as never);
    expect(response.status).toBe(422);
  });

  it('rejects structural Markdown selections before calling the provider', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const heading = await inlineEdit(request('/api/ai/inline-edit', {
      ...markdownBody, selectedText: '# Heading text',
    }) as never, {} as never);
    expect(heading.status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/inline-edit — failure hygiene', () => {
  it('bounds a stalled provider request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    const response = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(response.status).toBe(504);
  });

  it('does not expose source text from a provider failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private source text', { status: 500 })));
    const response = await inlineEdit(request('/api/ai/inline-edit', latexBody) as never, {} as never);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private source text');
    expect(logged.mock.calls.flat().join(' ')).not.toContain('private source text');
    logged.mockRestore();
  });
});
