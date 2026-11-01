import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readInlineEditStream, type InlineEditStreamEvent } from '@/src/lib/inline-edit-stream';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  doc: null as null | { id: string; userId: string; format: string },
  findFirst: vi.fn(),
  limit: vi.fn(),
  slotRelease: vi.fn(),
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

const DOCUMENT_ID = '9a1f2c33-5b7d-4e21-8c0a-2f6d1b9e4a77';
const latexBody = {
  documentId: DOCUMENT_ID,
  selectedText: 'A result \\cite{key} is useful.',
  before: ' ', after: ' ',
  mode: 'quickAction', action: 'clearer',
  stream: true,
};
const markdownBody = {
  documentId: DOCUMENT_ID,
  selectedText: 'The value is `x + 1` and links to [the docs](https://md.dev) clearly.',
  before: '\n\n', after: '\n\n',
  mode: 'quickAction', action: 'shorter',
  stream: true,
};

const enc = new TextEncoder();

function request(body: unknown, init?: { signal?: AbortSignal }) {
  return new NextRequest('http://localhost/api/ai/inline-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
}

function sseChunks(deltas: string[], extra: string[] = [], includeDone = true) {
  const lines = deltas.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  lines.push(...extra);
  if (includeDone) lines.push('data: [DONE]\n\n');
  return lines;
}

function streamResponse(chunks: string[], status = 200) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  }), { status });
}

function providerWith(chunks: string[]) {
  const captured: { signal?: AbortSignal } = {};
  const provider = vi.fn(async (_url: unknown, init?: RequestInit) => {
    captured.signal = init?.signal ?? undefined;
    return streamResponse(chunks);
  });
  return { provider, captured };
}

async function drain(response: Response): Promise<InlineEditStreamEvent[]> {
  const events: InlineEditStreamEvent[] = [];
  for await (const event of readInlineEditStream(response.body)) events.push(event);
  return events;
}

function joinedDeltas(events: InlineEditStreamEvent[]): string {
  return events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
}

async function until(condition: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'owner';
  mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'LATEX' };
  mocks.findFirst.mockImplementation(({ where }: { where: { userId: string } }) =>
    where.userId === 'owner' ? { ...mocks.doc } : null);
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });
  mocks.slotRelease = vi.fn(async () => {});
  mocks.slot.mockResolvedValue(mocks.slotRelease);
  process.env.OPENROUTER_API_KEY = 'test-key';
});

describe('POST /api/ai/inline-edit — streaming happy paths', () => {
  it('streams masked LaTeX deltas and ends with the verified restored replacement', async () => {
    const { provider } = providerWith(sseChunks(['The result ', '@@PROTECTED_0__', ' is useful.']));
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request(latexBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const events = await drain(response);
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThanOrEqual(3);
    expect(joinedDeltas(events)).toBe('The result @@PROTECTED_0__ is useful.');
    // Protected source bytes only ever travel in the terminal event.
    expect(JSON.stringify(deltas)).not.toContain('\\cite{key}');
    expect(events[events.length - 1]).toEqual({ type: 'done', replacementText: 'The result \\cite{key} is useful.' });

    const sent = JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
    expect(sent.stream).toBe(true);
    expect(sent.messages[1].content).toContain('@@PROTECTED_0__');
  });

  it('streams Markdown with the same masking and exact byte restore as the single-response path', async () => {
    const { provider } = providerWith(sseChunks(['The value is ', '@@PROTECTED_1__', ' and it links to @@PROTECTED_0__ clearly.']));
    vi.stubGlobal('fetch', provider);
    mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'MARKDOWN' };
    const events = await drain(await inlineEdit(request(markdownBody) as never, {} as never));
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      replacementText: 'The value is `x + 1` and it links to [the docs](https://md.dev) clearly.',
    });
    expect(JSON.stringify(events.filter((e) => e.type === 'delta'))).not.toContain('https://md.dev');
  });

  it('keeps the single-response contract when stream is not requested', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'The result @@PROTECTED_0__ is useful.' } }],
    }), { status: 200 })));
    const singleBody: Record<string, unknown> = { ...latexBody };
    delete singleBody.stream;
    const response = await inlineEdit(request(singleBody) as never, {} as never);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).replacementText).toBe('The result \\cite{key} is useful.');
  });
});

describe('POST /api/ai/inline-edit — refusals before the stream begins', () => {
  it('answers malformed, unauthorized, and quota failures as plain JSON statuses', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const badAction = await inlineEdit(request({ ...latexBody, action: 'make-it-poetic' }) as never, {} as never);
    expect(badAction.status).toBe(400);
    expect(badAction.headers.get('content-type')).toContain('application/json');

    mocks.userId = 'intruder';
    const forbidden = await inlineEdit(request(latexBody) as never, {} as never);
    expect(forbidden.status).toBe(404);
    mocks.userId = 'owner';

    mocks.slot.mockResolvedValue(null);
    const busy = await inlineEdit(request(latexBody) as never, {} as never);
    expect(busy.status).toBe(429);

    const crossBlock = await inlineEdit(request({ ...latexBody, selectedText: 'First para.\n\nSecond para.' }) as never, {} as never);
    expect(crossBlock.status).toBe(422);

    expect(provider).not.toHaveBeenCalled();
  });

  it('maps a failing provider status to a 502 JSON response before committing the stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider exploded', { status: 500 })));
    const response = await inlineEdit(request(latexBody) as never, {} as never);
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(mocks.slotRelease).toHaveBeenCalled();
  });
});

describe('POST /api/ai/inline-edit — terminal validation events', () => {
  it('ends with a protected error when streamed output drops a token', async () => {
    const { provider } = providerWith(sseChunks(['The result ', 'is useful.']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await inlineEdit(request(latexBody) as never, {} as never));
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(events[events.length - 1]).toEqual({
      type: 'error', code: 'protected', message: 'AI response changed protected LaTeX',
    });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('ends with noop when the provider echoes the masked selection unchanged', async () => {
    const { provider } = providerWith(sseChunks(['A result ', '@@PROTECTED_0__ is ', 'useful.']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await inlineEdit(request(latexBody) as never, {} as never));
    expect(events[events.length - 1]).toEqual({ type: 'noop', explanation: 'No change suggested' });
  });

  it('reports an empty stream as an error and never as a done event', async () => {
    const { provider } = providerWith(sseChunks([]));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await inlineEdit(request(latexBody) as never, {} as never));
    expect(events).toEqual([{ type: 'error', code: 'empty', message: 'Empty AI response' }]);
  });

  it('surfaces an in-band provider error payload as a safe error event', async () => {
    const { provider } = providerWith(sseChunks(['The result '], ['data: {"error":{"message":"provider detail"}}\n\n']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await inlineEdit(request(latexBody) as never, {} as never));
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'provider', message: 'AI service error' });
  });

  it('enforces the cumulative size cap mid-stream and stops sending deltas', async () => {
    // selectedText length 29 → cap = min(12000, 29*5+100) = 245 characters.
    const chunks = Array.from({ length: 12 }, () => 'x'.repeat(30));
    const { provider } = providerWith(sseChunks(chunks));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await inlineEdit(request(latexBody) as never, {} as never));
    expect(joinedDeltas(events).length).toBeLessThanOrEqual(245);
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'too_large', message: 'AI response too large' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(mocks.slotRelease).toHaveBeenCalled();
  });
});

describe('POST /api/ai/inline-edit — cancellation and timeouts', () => {
  function stalledProvider() {
    const captured: { signal?: AbortSignal } = {};
    const provider = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      captured.signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"The "}}]}\n\n'));
        },
        pull() {
          // Never delivers more data; errors out when the route aborts the
          // provider fetch, exactly like a real fetch body would.
          return new Promise<void>((resolve, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (captured.signal?.aborted) abort();
            else captured.signal?.addEventListener('abort', abort, { once: true });
          });
        },
      }), { status: 200 });
    });
    return { provider, captured };
  }

  it('propagates a client disconnect to the provider and releases the AI slot', async () => {
    const { provider, captured } = stalledProvider();
    vi.stubGlobal('fetch', provider);
    const client = new AbortController();
    const response = await inlineEdit(request(latexBody, { signal: client.signal }) as never, {} as never);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"delta"');

    client.abort();
    await until(() => captured.signal?.aborted === true);
    await until(() => mocks.slotRelease.mock.calls.length > 0);

    // The stream closes without ever delivering a done event.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(new TextDecoder().decode(value)).not.toContain('"done"');
    }
  });

  it('stops provider reads and frees the slot when the editor presses Stop (body cancel)', async () => {
    const { provider, captured } = stalledProvider();
    vi.stubGlobal('fetch', provider);
    const response = await inlineEdit(request(latexBody) as never, {} as never);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await until(() => captured.signal?.aborted === true);
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('emits a timeout error event when the 15-second budget runs out mid-stream', async () => {
    vi.useFakeTimers();
    try {
      const { provider, captured } = stalledProvider();
      vi.stubGlobal('fetch', provider);
      const pending = inlineEdit(request(latexBody) as never, {} as never);
      // Drain the promise chain without firing the route's 15s timer.
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
      expect(provider).toHaveBeenCalled();
      const response = await pending;
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('"delta"');

      await vi.advanceTimersByTimeAsync(15_000);
      expect(captured.signal?.aborted).toBe(true);

      const decoder = new TextDecoder();
      let tail = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tail += decoder.decode(value, { stream: true });
      }
      expect(tail).toContain('"timeout"');
      expect(tail).not.toContain('"done"');
      expect(mocks.slotRelease).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
