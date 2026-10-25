"use client";

// Invitation acceptance. The token in the URL is not a grant: the API compares the signed-in
// account's stored email with the address the invitation was issued to, so this page mostly
// explains why a link cannot be opened. Nothing here decides access.

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { DOCUMENTS_PATH, SIGN_IN_PATH } from '@/src/lib/paths';
import Logo from '@/src/app/components/brand/logo';

type Preview =
  | { state: 'unknown' }
  | { state: 'expired'; inviterName: string; targetLabel: string }
  | { state: 'revoked'; inviterName: string; targetLabel: string }
  | { state: 'accepted-by-you' }
  | { state: 'accepted' }
  | { state: 'wrong-email'; signedInEmail: string }
  | { state: 'valid'; id: string; targetKind: 'TEAM' | 'WORKSPACE' | 'DOCUMENT'; targetLabel: string; inviterName: string; permission: 'VIEW' };

const kindLabel: Record<'TEAM' | 'WORKSPACE' | 'DOCUMENT', string> = {
  TEAM: 'team',
  WORKSPACE: 'workspace',
  DOCUMENT: 'document',
};

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const router = useRouter();
  const { status } = useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/invitations/' + encodeURIComponent(token));
      const data = await response.json().catch(() => ({}));
      setPreview((data.preview as Preview) ?? { state: 'unknown' });
    } catch {
      setPreview({ state: 'unknown' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(SIGN_IN_PATH + '?next=' + encodeURIComponent('/invite/' + token));
    if (status === 'authenticated' && token) void load();
  }, [status, token, load, router]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/invitations/' + encodeURIComponent(token), { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not accept this invitation');
        setPreview((data.preview as Preview) ?? preview);
        return;
      }
      setAccepted(true);
      setPreview((data.preview as Preview) ?? preview);
    } catch {
      setError('Could not accept this invitation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex justify-center"><Logo variant="wordmark" size="sm" /></div>

        {loading && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking the invitation
          </p>
        )}

        {!loading && accepted && (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-foreground">You can open it now</h1>
            <p className="mt-2 text-sm text-muted-foreground">Access is active for this account.</p>
            <Link href={DOCUMENTS_PATH} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-action px-4 text-sm font-medium text-white">
              Go to your documents
            </Link>
          </div>
        )}

        {!loading && !accepted && preview?.state === 'valid' && (
          <div>
            <h1 className="text-lg font-semibold text-foreground">Join {preview.targetLabel}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.inviterName} invited you to view their {kindLabel[preview.targetKind]}. Reading only: you will not be able to edit, and the owner can revoke access at any time.
            </p>
            {error && <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}
            <button type="button" onClick={() => void accept()} disabled={busy}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-action px-4 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Accept invitation
            </button>
          </div>
        )}

        {!loading && !accepted && (preview === null || preview.state === 'unknown') && (
          <div>
            <h1 className="text-lg font-semibold text-foreground">This link is not valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">It was never issued, or it has already been used and replaced. Ask the owner to send a new one.</p>
          </div>
        )}

        {!loading && !accepted && (preview?.state === 'expired' || preview?.state === 'revoked') && (
          <div>
            <h1 className="text-lg font-semibold text-foreground">{preview.state === 'expired' ? 'This invitation expired' : 'This invitation was cancelled'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.inviterName} invited you to {preview.targetLabel}, but it is {preview.state === 'expired' ? 'past its expiry date' : 'no longer active'}. Ask them to send a new invitation.
            </p>
          </div>
        )}

        {!loading && !accepted && preview?.state === 'wrong-email' && (
          <div>
            <h1 className="text-lg font-semibold text-foreground">Wrong account</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This invitation was issued to a different address, and access follows the account rather than the link. Sign in with the invited account to open it. You are currently signed in as {preview.signedInEmail}.
            </p>
            <Link href={SIGN_IN_PATH} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-raised">
              Switch account
            </Link>
          </div>
        )}

        {!loading && !accepted && (preview?.state === 'accepted' || preview?.state === 'accepted-by-you') && (
          <div>
            <h1 className="text-lg font-semibold text-foreground">Already accepted</h1>
            <p className="mt-2 text-sm text-muted-foreground">Someone already used this invitation. If it was you, the shared item is in your library.</p>
            <Link href={DOCUMENTS_PATH} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-action px-4 text-sm font-medium text-white">Open your library</Link>
          </div>
        )}
      </div>
    </main>
  );
}
