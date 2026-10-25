"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

/**
 * Moves a document into another workspace the author may author in.
 *
 * A move changes who can see the document, so the API first answers with the impact and the move
 * is only applied on a second, explicit confirm. Any collision message comes back verbatim.
 */

export type MoveWorkspaceOption = { id: string; name: string; kind: "PERSONAL" | "TEAM"; canCreate: boolean; teamName?: string | null };

interface MoveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  currentWorkspaceId?: string | null;
  workspaces: MoveWorkspaceOption[];
  onMoved?: () => void;
}

type Impact = { gainsTeamVisibility: string[]; losesTeamVisibility: string[]; keepsDirectShares: number } | null;

export default function MoveDialog({ isOpen, onClose, documentId, documentTitle, currentWorkspaceId, workspaces, onMoved }: MoveDialogProps) {
  const options = workspaces.filter((workspace) => workspace.canCreate && workspace.id !== currentWorkspaceId);
  const [destination, setDestination] = useState(options[0]?.id ?? "");
  const [impact, setImpact] = useState<Impact>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const reset = useCallback(() => {
    setDestination(options[0]?.id ?? "");
    setImpact(null);
    setError(null);
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces.length, currentWorkspaceId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    reset();
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, reset]);

  if (!isOpen) return null;

  const move = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: destination, confirm }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Could not move this document");
      if (data.confirm) {
        setImpact(data.impact ?? { gainsTeamVisibility: [], losesTeamVisibility: [], keepsDirectShares: 0 });
      } else {
        setDone(true);
        onMoved?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not move this document");
    } finally {
      setBusy(false);
    }
  };

  const target = options.find((workspace) => workspace.id === destination);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-0 sm:items-center sm:p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Move ${documentTitle}`} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl border border-border bg-surface shadow-overlay sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">Move document</h2>
            <p className="truncate text-xs text-meta">{documentTitle}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close move dialog" className="inline-flex size-9 items-center justify-center rounded-md text-meta hover:bg-surface-raised hover:text-foreground">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {done ? (
            <p role="status" className="rounded-md border border-border-subtle bg-surface-raised px-3 py-3 text-sm text-foreground">Moved to {target?.name ?? "the selected workspace"}.</p>
          ) : (
            <>
              <label htmlFor="move-destination" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-meta">Move to</label>
              <select id="move-destination" value={destination} onChange={(event) => { setDestination(event.target.value); setImpact(null); }} disabled={busy}
                className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-action focus:outline-none">
                {options.length === 0 && <option value="">No other workspace you can author in</option>}
                {options.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.kind === "TEAM" ? `Team · ${workspace.teamName ?? workspace.name}` : workspace.name}</option>
                ))}
              </select>

              {impact && (
                <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
                  {impact.gainsTeamVisibility.length > 0 && <p>Everyone in the destination team ({impact.gainsTeamVisibility.length}) will be able to open this document.</p>}
                  {impact.losesTeamVisibility.length > 0 && <p>The current team ({impact.losesTeamVisibility.length}) will no longer see it through the team.</p>}
                  {impact.keepsDirectShares > 0 && <p>{impact.keepsDirectShares} direct share{impact.keepsDirectShares === 1 ? "" : "s"} stay in place either way.</p>}
                  <p className="font-medium text-foreground">Confirm the move.</p>
                </div>
              )}

              {error && <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}
            </>
          )}
        </div>

        {!done && (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-raised">Cancel</button>
            <button type="button" disabled={busy || destination.length === 0} onClick={() => void move(impact !== null)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-action px-4 text-sm font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{impact ? "Confirm move" : "Move"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
