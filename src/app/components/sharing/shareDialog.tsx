"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, Trash2, X } from "lucide-react";

/**
 * Sharing for one document or one personal workspace.
 *
 * The server decides who may share; this dialog only reflects what the API says, so a recipient
 * who lost access sees the list disappear instead of a stale panel. Invitation links are shown
 * only when the API returns one, which happens in development because no mail provider is set.
 */

export type ShareTarget = { kind: "DOCUMENT" | "WORKSPACE"; id: string; label: string };

type ShareRow = {
  id: string;
  kind: "grant" | "invitation";
  email: string;
  permission: "VIEW";
  status: "active" | "pending" | "revoked" | "expired";
  since: string;
  expiresAt: string | null;
  inviteUrl?: string;
};

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTarget;
  onClosed?: () => void;
}

function endpointFor(target: ShareTarget) {
  return target.kind === "DOCUMENT" ? `/api/documents/${target.id}/shares` : `/api/workspaces/${target.id}/shares`;
}

const statusLabel: Record<ShareRow["status"], string> = {
  active: "Can view",
  pending: "Invitation sent",
  revoked: "Revoked",
  expired: "Expired",
};

export default function ShareDialog({ isOpen, onClose, target, onClosed }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpointFor(target));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "This item is no longer shared with you");
      setShares(data.shares ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load sharing");
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    void load();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      onClosed?.();
    };
  }, [isOpen, load, onClose, onClosed]);

  if (!isOpen) return null;

  const invite = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpointFor(target), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Could not send the invitation");
      setEmail("");
      setNotice(data.invitation?.inviteUrl ? `Invite link for ${data.invitation.invitedEmail}: ${data.invitation.inviteUrl}` : `Invitation sent to ${email.trim()}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send the invitation");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (share: ShareRow) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpointFor(target)}?shareId=${encodeURIComponent(share.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Could not revoke access");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not revoke access");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-0 sm:items-center sm:p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Sharing ${target.label}`} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl border border-border bg-surface shadow-overlay sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">Share {target.kind === "DOCUMENT" ? "document" : "workspace"}</h2>
            <p className="truncate text-xs text-meta">{target.label}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close sharing" className="inline-flex size-9 items-center justify-center rounded-md text-meta hover:bg-surface-raised hover:text-foreground">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
            People you invite can read{target.kind === "WORKSPACE" ? " this workspace and every document in it, including ones you add later" : " only this document"}. Reading never allows editing, and you can revoke it at any time.
          </p>

          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
            <label className="sr-only" htmlFor="share-email">Email address</label>
            <input id="share-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@university.edu"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none" />
            <button type="submit" disabled={busy || email.trim().length === 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-action px-4 text-sm font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Invite
            </button>
          </form>

          {error && <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}
          {notice && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 break-all">{notice}</span>
              <button type="button" aria-label="Copy invite link" onClick={() => void navigator.clipboard?.writeText(notice)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-meta hover:text-foreground">
                <Copy className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-meta">Who has access</h3>
          {loading ? (
            <p className="py-6 text-center text-sm text-meta">Loading…</p>
          ) : shares.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nobody else yet. Only you can open this.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {shares.map((share) => (
                <li key={`${share.kind}-${share.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                  <span className="min-w-0 flex-1 truncate text-foreground">{share.email}</span>
                  <span className="shrink-0 text-xs text-meta">{statusLabel[share.status]}</span>
                  {(share.status === "active" || share.status === "pending") && (
                    <button type="button" disabled={busy} onClick={() => void revoke(share)} aria-label={`Revoke access for ${share.email}`}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-meta hover:text-destructive disabled:opacity-50">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="min-h-11 w-full rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-raised sm:w-auto">Done</button>
        </div>
      </div>
    </div>
  );
}
