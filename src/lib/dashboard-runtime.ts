// Framework-free request logic for the document library. The React hook owns component state; this
// module owns which URLs the library talks to and which in-flight response is still valid, so the
// workspace-scoped list and the favorite mutation can be exercised without a DOM.
//
// Both the list and the mutations live here on purpose: the list endpoint carries the selected
// workspace, and every per-row mutation keys on the immutable document id (see dashboard-library.ts)
// so a same-slug twin in another workspace is never touched by accident.

import { documentApiUrl, documentsListUrl } from '@/src/lib/dashboard-library';

type LibraryResponse = {
  documents?: unknown[];
  workspaces?: unknown[];
};

export type DocumentsSink<T> = {
  setDocuments: (documents: T[]) => void;
  setWorkspaces: (workspaces: unknown[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export type DocumentsRuntime = {
  /** Fetches the list for one scope. Responses from superseded requests are dropped, not written. */
  load: (workspaceId: string | null) => Promise<void>;
  /** Favorites or unfavorites a row by id. Throws when the server rejects the change. */
  setFavorite: (document: { id: string }, isFavorite: boolean) => Promise<void>;
  /** Deletes a row by id. Throws when the server rejects the change. */
  remove: (document: { id: string }) => Promise<void>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createDocumentsRuntime<T extends { id: string }>(
  sink: DocumentsSink<T>,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): DocumentsRuntime {
  // Monotonic token: only the most recent load may commit. A slower earlier request that resolves
  // after a faster later one is stale, and writing it would replace the current workspace's rows
  // with another scope's — which the client-side scope filter then hides as an empty list.
  let latest = 0;

  async function load(workspaceId: string | null): Promise<void> {
    const request = ++latest;
    sink.setLoading(true);
    sink.setError(null);
    try {
      const response = await fetchImpl(documentsListUrl(workspaceId));
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = (await response.json()) as LibraryResponse;
      if (request !== latest) return;
      sink.setDocuments((data.documents ?? []) as T[]);
      sink.setWorkspaces(data.workspaces ?? []);
    } catch (err: unknown) {
      if (request !== latest) return;
      sink.setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      if (request === latest) sink.setLoading(false);
    }
  }

  async function setFavorite(document: { id: string }, isFavorite: boolean): Promise<void> {
    const response = await fetchImpl(documentApiUrl(document), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite }),
    });
    if (!response.ok) throw new Error('Failed to update favorite');
  }

  async function remove(document: { id: string }): Promise<void> {
    const response = await fetchImpl(documentApiUrl(document), { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete document');
  }

  return { load, setFavorite, remove };
}
