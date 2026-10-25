import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { LibraryWorkspace, MovePreview } from '@/src/types/library';

function failureMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(failureMessage(body, 'Request failed'));
  return body as T;
}

/**
 * The workspace half of the library: every collection the signed-in user may open, with the
 * server-decided capability flags, plus the create, rename and move actions the library offers.
 * Nothing here decides permissions; a refused action arrives as an error from the API.
 */
export function useLibrary() {
  const { status } = useSession();
  const [workspaces, setWorkspaces] = useState<LibraryWorkspace[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await request<{ workspaces: LibraryWorkspace[]; pendingInvitations: number }>('/api/workspaces');
      setWorkspaces(data.workspaces ?? []);
      setPendingInvitations(data.pendingInvitations ?? 0);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void refresh();
  }, [status, refresh]);

  const createWorkspace = useCallback(async (name: string) => {
    const data = await request<{ workspace: LibraryWorkspace }>('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await refresh();
    return data.workspace;
  }, [refresh]);

  const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    const data = await request<{ workspace: LibraryWorkspace }>(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await refresh();
    return data.workspace;
  }, [refresh]);

  /**
   * Moves an authored document. `preview` returns what would change without changing anything,
   * which is what the confirmation dialog shows.
   */
  const moveDocument = useCallback(async (documentId: string, workspaceId: string, preview = false) => {
    const data = await request<{ preview?: MovePreview; move?: MovePreview }>(
      `/api/documents/${documentId}/move${preview ? '?preview=1' : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      },
    );
    if (!preview) await refresh();
    return data.preview ?? data.move;
  }, [refresh]);

  return { workspaces, pendingInvitations, loading, error, setError, refresh, createWorkspace, renameWorkspace, moveDocument };
}
