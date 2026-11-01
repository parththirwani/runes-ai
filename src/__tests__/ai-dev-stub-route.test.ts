import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { POST as complete } from '@/src/app/api/ai/complete/route';

const DOCUMENT_ID = '9a1f2c33-5b7d-4e21-8c0a-2f6d1b9e4a77';

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Route handlers take the request plus the (unused) route context.
const callEdit = (body: unknown) => inlineEdit(post('/api/ai/inline-edit', body) as never, {} as never);
const callComplete = (body: unknown) => complete(post('/api/ai/complete', body) as never, {} as never);

async function readEvents(response: Response) {
  const events: Record<string, unknown>[] = [];
  for (const line of (await response.text()).split('\n')) {
    if (line.trim() !== '') events.push(JSON.parse(line) as Record<string, unknown>);
  }
  return events;
}

function markdownDoc() {
  mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'MARKDOWN' };
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? { ...mocks.doc } : null);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'LATEX' };
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? { ...mocks.doc } : null);
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
  mocks.slot.mockResolvedValue(async () => {});
  // The whole point of the stub: no provider key anywhere.
  delete process.env.OPENROUTER_API_KEY;
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('AI_DEV_STUB', '1');
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/ai/inline-edit with the development stub', () => {
  it('answers a LaTeX quick action with no provider call and restores the citation bytes', async () => {
    const response = await callEdit({
      documentId: DOCUMENT_ID,
      selectedText: 'A result \\cite{key} is useful.',
      before: ' ', after: ' ',
      mode: 'quickAction', action: 'clearer',
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const data = await response.json();
    expect(data.noop).toBe(false);
    expect(data.replacementText).toBe('Overall, a result \\cite{key} is useful.');
  });

  it('streams a Markdown edit as validated NDJSON with protected spans intact', async () => {
    markdownDoc();
    const response = await callEdit({
      documentId: DOCUMENT_ID,
      selectedText: 'The value is very `x + 1` and links to [the docs](https://md.dev) clearly.',
      before: '\n\n', after: '\n\n',
      mode: 'quickAction', action: 'shorter',
      stream: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(fetchSpy).not.toHaveBeenCalled();

    const events = await readEvents(response);
    const deltas = events.filter((event) => event.type === 'delta');
    expect(deltas.length).toBeGreaterThan(1);
    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    // The shorter stub drops the filler word and keeps code and link bytes exactly.
    expect(last.replacementText)
      .toBe('The value is `x + 1` and links to [the docs](https://md.dev) clearly.');
    expect(JSON.stringify(deltas)).toContain('@@PROTECTED_');
  });

  it('still refuses a shared reader and a cross-block selection before answering', async () => {
    mocks.userId = 'reader';
    const denied = await callEdit({
      documentId: DOCUMENT_ID,
      selectedText: 'Some prose.',
      before: ' ', after: ' ',
      mode: 'quickAction', action: 'clearer',
    });
    expect(denied.status).toBe(404);
    mocks.userId = 'owner';

    const crossBlock = await callEdit({
      documentId: DOCUMENT_ID,
      selectedText: 'First block.\n\nSecond block.',
      before: ' ', after: ' ',
      mode: 'instruction', instruction: 'merge these',
    });
    expect(crossBlock.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs a free instruction through the same protected-token validation', async () => {
    const response = await callEdit({
      documentId: DOCUMENT_ID,
      selectedText: 'The team ran the trial twice.',
      before: ' ', after: ' ',
      mode: 'instruction', instruction: 'make it warmer and clearer',
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.replacementText).toBe('Overall, the team ran the trial twice.');
  });
});

describe('POST /api/ai/complete with the development stub', () => {
  it('returns a deterministic insertion that passes the format filters', async () => {
    const response = await callComplete({
      documentId: DOCUMENT_ID,
      prefix: '\\begin{document}\nThe measured value rose again and then',
      suffix: '.',
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const data = await response.json();
    expect(data.insertion).toBe(' and the same pattern held across the next set of runs');
  });

  it('offers nothing on the dev trigger so the No suggestion state is reachable', async () => {
    const response = await callComplete({
      documentId: DOCUMENT_ID,
      prefix: '\\begin{document}\nThe measured value rose after the timeout',
      suffix: '.',
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.insertion).toBeNull();
  });
});
