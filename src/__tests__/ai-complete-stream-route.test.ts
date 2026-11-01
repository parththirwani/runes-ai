import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readCompleteStream, type CompleteStreamEvent } from '@/src/lib/ghost-text';

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

import { POST as complete } from '@/src/app/api/ai/complete/route';

const DOCUMENT_ID = 'b7d4e1f2-0a39-4c58-91d6-7e2f4a8c3b10';
const latexBody = { documentId: DOCUMENT_ID, prefix: 'A result', suffix: ' follows.', requestId: '1', stream: true };
const markdownBody = { documentId: DOCUMENT_ID, prefix: 'The value is high', suffix: ' and rising.', requestId: '1', stream: true };

const enc = new TextEncoder();

function request(body: unknown, init?: { signal?: AbortSignal }) {
  return new NextRequest('http://localhost/api/ai/complete', {
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

async function drain(response: Response): Promise<CompleteStreamEvent[]> {
  const events: CompleteStreamEvent[] = [];
  for await (const event of readCompleteStream(response.body)) events.push(event);
  return events;
}

function joinedDeltas(events: CompleteStreamEvent[]): string {
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

describe('POST /api/ai/complete — streaming happy paths', () => {
  it('streams LaTeX deltas and ends with the filtered insertion plus the real provider/model', async () => {
    const { provider } = providerWith(sseChunks([' was measured ', 'twice in ', 'the lab']));
    vi.stubGlobal('fetch', provider);
    const response = await complete(request(latexBody) as never, {} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const events = await drain(response);
    expect(joinedDeltas(events)).toBe(' was measured twice in the lab');
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      insertion: ' was measured twice in the lab',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const sent = JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('openai/gpt-4o-mini');
  });

  it('streams Markdown prose continuations through the same filter rules', async () => {
    mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'MARKDOWN' };
    const { provider } = providerWith(sseChunks([' across the next', ' set of runs']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(markdownBody) as never, {} as never));
    expect(events[events.length - 1]).toMatchObject({
      type: 'done',
      insertion: ' across the next set of runs',
    });
  });

  it('keeps the single-response contract and only adds provider/model identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: ' was measured twice' } }],
    }), { status: 200 })));
    const singleBody: Record<string, unknown> = { ...latexBody };
    delete singleBody.stream;
    const response = await complete(request(singleBody) as never, {} as never);
    expect(response.headers.get('content-type')).toContain('application/json');
    const data = await response.json();
    expect(data.insertion).toBe(' was measured twice');
    expect(data.provider).toBe('openrouter');
    expect(data.model).toBe('openai/gpt-4o-mini');
  });

  it('reports the real model identity even when the filter rejects the completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '\\input{other}' } }],
    }), { status: 200 })));
    const singleBody: Record<string, unknown> = { ...latexBody };
    delete singleBody.stream;
    const data = await (await complete(request(singleBody) as never, {} as never)).json();
    expect(data.insertion).toBeNull();
    expect(data.model).toBe('openai/gpt-4o-mini');
  });
});

describe('POST /api/ai/complete — refusals before the stream begins', () => {
  it('answers malformed, unauthorized, and quota failures as plain JSON statuses', async () => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const bad = await complete(request({ ...latexBody, prefix: 'x'.repeat(3_000) }) as never, {} as never);
    expect(bad.status).toBe(400);
    expect(bad.headers.get('content-type')).toContain('application/json');

    mocks.userId = 'intruder';
    const forbidden = await complete(request(latexBody) as never, {} as never);
    expect(forbidden.status).toBe(404);
    mocks.userId = 'owner';

    mocks.limit.mockResolvedValue({ allowed: false, retryAfter: 9 });
    const limited = await complete(request(latexBody) as never, {} as never);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');
    mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 1 });

    mocks.slot.mockResolvedValue(null);
    const busy = await complete(request(latexBody) as never, {} as never);
    expect(busy.status).toBe(429);

    expect(provider).not.toHaveBeenCalled();
  });

  it('stays silent in protected Markdown context before any provider call', async () => {
    mocks.doc = { id: DOCUMENT_ID, userId: 'owner', format: 'MARKDOWN' };
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const response = await complete(
      request({ ...markdownBody, prefix: 'The value is inside `code' }) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).insertion).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('maps a failing provider status to a 502 JSON response before committing the stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider exploded', { status: 500 })));
    const response = await complete(request(latexBody) as never, {} as never);
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(mocks.slotRelease).toHaveBeenCalled();
  });
});

describe('POST /api/ai/complete — terminal events', () => {
  it('finishes with a null insertion when the filter rejects streamed output', async () => {
    const { provider } = providerWith(sseChunks(['run ', '\\section{', 'later }']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(latexBody) as never, {} as never));
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(events[events.length - 1]).toEqual({
      type: 'done', insertion: null, provider: 'openrouter', model: 'openai/gpt-4o-mini',
    });
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('treats an empty stream as no suggestion, not as an error', async () => {
    const { provider } = providerWith(sseChunks([]));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(latexBody) as never, {} as never));
    expect(events).toEqual([{ type: 'done', insertion: null, provider: 'openrouter', model: 'openai/gpt-4o-mini' }]);
  });

  it('surfaces an in-band provider error payload as a safe error event', async () => {
    const { provider } = providerWith(sseChunks(['was measured '], ['data: {"error":{"message":"provider detail"}}\n\n']));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(latexBody) as never, {} as never));
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'provider', message: 'AI completion unavailable' });
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('enforces the cumulative size cap mid-stream and stops sending deltas', async () => {
    const chunks = Array.from({ length: 30 }, () => `${'x'.repeat(15)} `);
    const { provider } = providerWith(sseChunks(chunks));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(latexBody) as never, {} as never));
    expect(joinedDeltas(events).length).toBeLessThanOrEqual(400 + 16);
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'too_large', message: 'AI completion too large' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('cuts a completion that passes the stream cap check only to be dropped by the 200-char insertion cap', async () => {
    const text = 'w '.repeat(120); // 240 chars: under the 400 stream cap, over the 200 ghost cap
    const { provider } = providerWith(sseChunks([text]));
    vi.stubGlobal('fetch', provider);
    const events = await drain(await complete(request(latexBody) as never, {} as never));
    expect(events[events.length - 1]).toMatchObject({ type: 'done', insertion: null });
  });
});

describe('POST /api/ai/complete — cancellation and timeouts', () => {
  function stalledProvider() {
    const captured: { signal?: AbortSignal } = {};
    const provider = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      captured.signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":" was "}}]}\n\n'));
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
    const response = await complete(request(latexBody, { signal: client.signal }) as never, {} as never);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"delta"');

    client.abort();
    await until(() => captured.signal?.aborted === true);
    await until(() => mocks.slotRelease.mock.calls.length > 0);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(new TextDecoder().decode(value)).not.toContain('"done"');
    }
  });

  it('stops provider reads and frees the slot when the ghost is dismissed (body cancel)', async () => {
    const { provider, captured } = stalledProvider();
    vi.stubGlobal('fetch', provider);
    const response = await complete(request(latexBody) as never, {} as never);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await until(() => captured.signal?.aborted === true);
    expect(mocks.slotRelease).toHaveBeenCalled();
  });

  it('emits a timeout error event when the 10-second budget runs out mid-stream', async () => {
    vi.useFakeTimers();
    try {
      const { provider, captured } = stalledProvider();
      vi.stubGlobal('fetch', provider);
      const pending = complete(request(latexBody) as never, {} as never);
      await vi.advanceTimersByTimeAsync(10);
      const response = await pending;
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('"delta"');

      await vi.advanceTimersByTimeAsync(10_000);
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
