"use client";

import { useState } from "react";
import { Copy, Trash2, TriangleAlert } from "lucide-react";
import Modal from "../design/Modal";
import Button from "../design/Button";
import { useShares, type ShareTarget } from "@/src/hooks/useShares";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTarget | null;
  title: string;
  /** Explains the scope of what the reader will be able to see. */
  description: string;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

/**
 * Invites readers by address and lists who already has a grant. Two rules the copy states out
 * loud, because they are what the server enforces: an invitation grants nothing until the named
 * person accepts it, and revoking applies to the next request rather than a page already open.
 */
export default function ShareModal({ isOpen, onClose, target, title, description }: ShareModalProps) {
  const [email, setEmail] = useState("");
  const shares = useShares(isOpen && target ? target : null);
  const [copied, setCopied] = useState(false);

  const pending = shares.shares.filter((row) => row.status === "PENDING");
  const accepted = shares.shares.filter((row) => row.status === "ACCEPTED");
  const revoked = shares.shares.filter((row) => row.status === "REVOKED");
  const devLink = shares.lastInvitation?.delivery.channel === "development-link" ? shares.lastInvitation.delivery.path : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    const invitation = await shares.invite(value);
    if (invitation) setEmail("");
  };

  const copyDevLink = async () => {
    if (!devLink) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${devLink}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="share-email" className="mb-1 block text-xs font-medium text-muted-foreground">Invite by email</label>
          <input
            id="share-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="h-10 w-full rounded border border-input bg-surface px-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none focus-visible:ring-2 focus-visible:ring-action/25"
          />
        </div>
        <Button type="submit" loading={shares.busy} disabled={!email.trim()}>Send invite</Button>
      </form>

      <p className="mt-2 text-xs text-meta">
        The invitation only opens for the address it was sent to, and grants view access after it is accepted.
      </p>

      {devLink && (
        <div className="mt-3 rounded border border-border bg-surface-raised p-3">
          <p className="text-xs font-medium text-foreground">Delivery is local in this environment</p>
          <p className="mt-1 text-xs text-meta">No email provider is configured, so the link is shown here for the inviter only. Set INVITE_EMAIL_WEBHOOK_URL to send it.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[11px] text-foreground">{devLink}</code>
            <Button size="sm" variant="secondary" onClick={() => void copyDevLink()} icon={<Copy size={14} aria-hidden="true" />}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}

      {shares.lastInvitation?.delivery.channel === "unavailable" && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning">
          <TriangleAlert size={14} aria-hidden="true" />
          The invitation exists but cannot be delivered yet: configure an email provider.
        </p>
      )}

      {shares.error && <p role="alert" className="mt-3 text-sm text-destructive">{shares.error}</p>}

      <div className="mt-4 space-y-4">
        {shares.loading && <p className="text-sm text-muted-foreground" role="status">Loading shares…</p>}

        <section aria-label="Pending invitations">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-meta">Pending ({pending.length})</h3>
          {pending.length === 0 && <p className="text-sm text-meta">Nobody is waiting to accept.</p>}
          <ul className="divide-y divide-border-subtle rounded border border-border-subtle">
            {pending.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{row.email}</span>
                  <span className="block text-[11px] text-meta">View · invited {formatDate(row.createdAt)}{row.expiresAt ? ` · expires ${formatDate(row.expiresAt)}` : ""}</span>
                </span>
                <Button size="sm" variant="ghost" loading={shares.busy} onClick={() => void shares.revoke("invitation", row.id)} icon={<Trash2 size={14} aria-hidden="true" />}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="People who can open this">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-meta">Can open now ({accepted.length})</h3>
          {accepted.length === 0 && <p className="text-sm text-meta">No accepted shares yet.</p>}
          <ul className="divide-y divide-border-subtle rounded border border-border-subtle">
            {accepted.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{row.recipientName ?? row.email}</span>
                  <span className="block text-[11px] text-meta">View only · accepted {formatDate(row.acceptedAt)}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={shares.busy}
                  onClick={() => void shares.revoke(target?.kind === "workspace" ? "workspace-grant" : "document-grant", row.id)}
                  icon={<Trash2 size={14} aria-hidden="true" />}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {revoked.length > 0 && (
          <section aria-label="Revoked shares">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-meta">Revoked ({revoked.length})</h3>
            <ul className="divide-y divide-border-subtle rounded border border-border-subtle">
              {revoked.map((row) => (
                <li key={row.id} className="px-3 py-2 text-sm text-meta">
                  <span className="block truncate">{row.email}</span>
                  <span className="block text-[11px]">No longer has access</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
