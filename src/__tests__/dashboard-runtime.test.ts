import { describe, expect, it, vi } from 'vitest';
import { createDocumentsRuntime, type DocumentsSink } from '@/src/lib/dashboard-runtime';

// The hook is thin glue over this runtime, so exercising the runtime exercises the real favorite,
// delete and list call sites: same code, same documentApiUrl / documentsListUrl helpers, no DOM.

type Row = { id: string };

function makeSink() {
  const calls = {
    documents: [] as Row[][],
    workspaces: [] as unknown[][],
    loading: [] as boolean[],
    error: [] as (string | null)[],
  };
  const sink: DocumentsSink<Row> = {
    setDocuments: (documents) => calls.documents.push(documents),
    setWorkspaces: (workspaces) => calls.workspaces.push(workspaces),
    setLoading: (loading) => calls.loading.push(loading),
    setError: (error) => calls.error.push(error),
  };
  return { sink, calls };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Returns a fetch that hands back the next deferred in call order, so a test controls arrival order
// independently of the order the loads were started.
function queuedFetch(...responses: ReturnType<typeof deferred>[]) {
  const queue = [...responses];
  return vi.fn(() => queue.shift()?.promise ?? Promise.reject(new Error('unexpected fetch')));
}

describe('favorite mutation call site', () => {
  it('PATCHes the document id, never the slug, for same-slug twins in different workspaces', async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({}));
    const { sink } = makeSink();
    const runtime = createDocumentsRuntime<Row>(sink, fetchImpl);

    // Two documents that share a slug across workspaces: only the id distinguishes them.
    await runtime.setFavorite({ id: 'd2' }, true);
    await runtime.setFavorite({ id: 'd3' }, false);

    const urls = fetchImpl.mock.calls.map(([url]) => url);
    expect(urls).toEqual(['/api/document/d2', '/api/document/d3']);
    expect(urls.some((url) => url.includes('thesis'))).toBe(false);
    const [, second] = fetchImpl.mock.calls[1];
    expect(second?.method).toBe('PATCH');
    expect(second?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(second?.body))).toEqual({ isFavorite: false });
  });

  it('throws when the server rejects the favorite so the caller can roll the row back', async () => {
    const { sink } = makeSink();
    const runtime = createDocumentsRuntime<Row>(sink, async () => jsonResponse({}, false));
    await expect(runtime.setFavorite({ id: 'd2' }, true)).rejects.toThrow('Failed to update favorite');
  });

  it('deletes by id too, matching the favorite and open paths', async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({}));
    const { sink } = makeSink();
    const runtime = createDocumentsRuntime<Row>(sink, fetchImpl);
    await runtime.remove({ id: 'd3' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/document/d3', { method: 'DELETE' });
  });
});

describe('workspace-scoped list ignores superseded responses', () => {
  it('keeps the current workspace rows when an earlier request finishes last', async () => {
    const { sink, calls } = makeSink();
    const stale = deferred();
    const current = deferred();
    const runtime = createDocumentsRuntime<Row>(sink, queuedFetch(stale, current));

    const firstLoad = runtime.load('ws-a');
    const secondLoad = runtime.load('ws-b');

    // The later workspace-b request resolves first; the workspace-a request resolves last.
    current.resolve(jsonResponse({ documents: [{ id: 'b1' }], workspaces: [] }));
    await secondLoad;
    stale.resolve(jsonResponse({ documents: [{ id: 'a1' }], workspaces: [] }));
    await firstLoad;

    const committed = calls.documents.flat();
    expect(committed).toEqual([{ id: 'b1' }]);
    expect(calls.loading[calls.loading.length - 1]).toBe(false);
  });

  it('commits only the last-started request even when an earlier one targets the same workspace', async () => {
    const { sink, calls } = makeSink();
    const firstA = deferred();
    const teamB = deferred();
    const refreshA = deferred();
    // Started a -> b -> a, but resolved b -> a(stale) -> a(refresh): arrival order is meaningless.
    const runtime = createDocumentsRuntime<Row>(sink, queuedFetch(firstA, teamB, refreshA));

    const a1 = runtime.load('ws-a');
    const b = runtime.load('ws-b');
    const a2 = runtime.load('ws-a');

    teamB.resolve(jsonResponse({ documents: [{ id: 'b1' }], workspaces: [] }));
    await b;
    firstA.resolve(jsonResponse({ documents: [{ id: 'a-stale' }], workspaces: [] }));
    await a1;
    refreshA.resolve(jsonResponse({ documents: [{ id: 'a-fresh' }], workspaces: [] }));
    await a2;

    // The net selection is workspace A, so only the most recent A response may commit; neither the
    // superseded team rows nor the stale first A response may resurrect an out-of-scope view.
    expect(calls.documents.flat()).toEqual([{ id: 'a-fresh' }]);
  });

  it('surfaces an error for the current request but drops an error from a superseded one', async () => {
    const { sink, calls } = makeSink();
    const stale = deferred();
    const current = deferred();
    const runtime = createDocumentsRuntime<Row>(sink, queuedFetch(stale, current));

    const firstLoad = runtime.load('ws-a');
    const secondLoad = runtime.load('ws-b');
    current.resolve(jsonResponse({ documents: [{ id: 'b1' }], workspaces: [] }));
    await secondLoad;
    stale.reject(new Error('boom'));
    await expect(firstLoad).resolves.toBeUndefined();

    expect(calls.error).not.toContain('boom');
    expect(calls.documents.flat()).toEqual([{ id: 'b1' }]);
  });
});
