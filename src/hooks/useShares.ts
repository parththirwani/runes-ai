import { useCallback, useEffect, useState } from 'react';
import type { CreatedInvitation, ShareRow } from '@/src/types/library';

/** Sharing a single document, or a whole personal workspace, with a reader by address. */
export type ShareTarget =
  | { kind: 'document'; id: string }
  | { kind: 'workspace'; id: string };

function pathFor(target: ShareTarget | null): string | null {
  if (!target) return null;
  if (target.kind === 'document') return `/api/documents/${target.id}/shares`;
  return `/api/workspaces/${target.id}/shares`;
}

async function failure(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
  }
  return fallback;
}

/**
 * Who can reach one document or workspace, and the invite/revoke actions over it. The server
 * answers `404` for anything the caller may not share, so an empty list and a refused target
 * deliberately look the same here.
 */
export function useShares(target: ShareTarget | null) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvitation, setLastInvitation] = useState<CreatedInvitation | null>(null);

  // One stable string drives every request, so the callbacks below never depend on the target
  // object a caller rebuilds on each render.
  const path = pathFor(target);

  const refresh = useCallback(async () => {
    if (!path) {
      setShares([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(await failure(response, 'Failed to load shares'));
      const data = await response.json();
      setShares(data.shares ?? []);
      setError(null);
    } catch (err: unknown) {
      setShares([]);
      setError(err instanceof Error ? err.message : 'Failed to load shares');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invite = useCallback(async (email: string) => {
    if (!path) return null;
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(await failure(response, 'Could not send the invitation'));
      const data = await response.json();
      setLastInvitation(data.invitation ?? null);
      await refresh();
      return data.invitation as CreatedInvitation;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
      return null;
    } finally {
      setBusy(false);
    }
  }, [path, refresh]);

  const revoke = useCallback(async (kind: 'invitation' | 'workspace-grant' | 'document-grant', id: string) => {
    if (!path) return false;
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      });
      if (!response.ok) throw new Error(await failure(response, 'Could not revoke access'));
      await refresh();
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not revoke access');
      return false;
    } finally {
      setBusy(false);
    }
  }, [path, refresh]);

  return { shares, loading, busy, error, lastInvitation, setLastInvitation, refresh, invite, revoke };
}
