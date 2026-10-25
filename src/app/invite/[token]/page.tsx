"use client";

// Invitation acceptance. The preview call is what decides the wording: an unknown, expired, or
// revoked token never reveals a document title, and a link sent to another address says only
// that it belongs to someone else. Access begins at the accept call and nowhere earlier.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TriangleAlert } from "lucide-react";
import Button from "@/src/app/components/design/Button";
import Logo from "@/src/app/components/brand/logo";
import { DOCUMENTS_PATH, SIGN_IN_PATH } from "@/src/lib/paths";

type Preview = {
  state: "valid" | "expired" | "revoked" | "accepted" | "wrong-email" | "unknown";
  target: "TEAM" | "WORKSPACE" | "DOCUMENT" | null;
  targetName: string | null;
  inviterName: string | null;
  permission: "VIEW" | "MEMBER" | "ADMIN";
  role: "ADMIN" | "MEMBER";
  expiresAt: string | null;
};

const CLOSED_COPY: Record<string, { title: string; body: string }> = {
  expired: { title: "This invitation has expired", body: "Ask the person who sent it for a new link." },
  revoked: { title: "This invitation was withdrawn", body: "The link no longer grants access." },
  accepted: { title: "Already accepted", body: "You can open this from your document library." },
  "wrong-email": { title: "This link is for a different account", body: "Sign in with the address the invitation was sent to." },
  unknown: { title: "This link is not valid", body: "It may have been mistyped, used up, or never issued." },
};

function targetNoun(target: Preview["target"]): string {
  if (target === "DOCUMENT") return "document";
  if (target === "WORKSPACE") return "workspace";
  return "team";
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const { status } = useSession();
  const token = typeof params.token === "string" ? params.token : "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
      if (response.status === 401) return;
      const data = await response.json();
      setPreview(data.preview ?? null);
    } catch {
      setPreview(null);
      setError("Could not check this invitation.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(SIGN_IN_PATH + "?callbackUrl=" + encodeURIComponent("/invite/" + token));
      return;
    }
    if (status === "authenticated" && token) void load();
  }, [status, token, router, load]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError((data as { message?: string } | null)?.message || "This invitation could not be accepted.");
        return;
      }
      const invitation = (data as { invitation?: { documentId?: string | null } } | null)?.invitation;
      // A document share lands on the document itself; anything broader lands in the library,
      // where the new workspace or team is listed by the workspace endpoint.
      if (invitation?.documentId) router.replace("/document/id/" + invitation.documentId);
      else router.replace(DOCUMENTS_PATH);
    } finally {
      setAccepting(false);
    }
  };

  const closed = preview ? CLOSED_COPY[preview.state] : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface px-6 py-8 shadow-paper">
        <div className="mb-6 flex justify-center">
          <Logo variant="wordmark" size="sm" />
        </div>

        {loading && (
          <p className="text-center text-sm text-muted-foreground" role="status">
            Checking the invitation...
          </p>
        )}

        {!loading && !preview && (
          <div className="text-center">
            <TriangleAlert className="mx-auto mb-3 h-5 w-5 text-destructive" aria-hidden="true" />
            <h1 className="text-base font-semibold text-foreground">{CLOSED_COPY.unknown.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error || CLOSED_COPY.unknown.body}</p>
            <Button className="mt-6 w-full" onClick={() => router.push(DOCUMENTS_PATH)}>Go to documents</Button>
          </div>
        )}

        {!loading && preview && closed && (
          <div className="text-center">
            <TriangleAlert className="mx-auto mb-3 h-5 w-5 text-warning" aria-hidden="true" />
            <h1 className="text-base font-semibold text-foreground">{closed.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{closed.body}</p>
            <Button className="mt-6 w-full" variant="secondary" onClick={() => router.push(DOCUMENTS_PATH)}>
              Go to documents
            </Button>
          </div>
        )}

        {!loading && preview && preview.state === "valid" && (
          <div>
            <h1 className="text-center text-lg font-semibold text-foreground">
              Open this {targetNoun(preview.target)}?
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              {preview.inviterName ?? "Someone"} invited you to view <span className="font-medium text-foreground">{preview.targetName}</span>.
            </p>

            <dl className="mt-6 space-y-2 rounded border border-border-subtle bg-surface-raised p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-meta">What you get</dt>
                <dd className="text-foreground">
                  {preview.target === "TEAM"
                    ? preview.role === "ADMIN"
                      ? "Team member (admin)"
                      : "Team member"
                    : "View only"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-meta">Invited by</dt>
                <dd className="text-foreground">{preview.inviterName ?? "Unknown"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-meta">Expires</dt>
                <dd className="text-foreground">
                  {preview.expiresAt
                    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(preview.expiresAt))
                    : "No expiry"}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-meta">
              Viewing access only: you will not be able to edit, move, or delete it, and the owner can revoke the share at any time.
            </p>

            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

            <Button className="mt-6 w-full" loading={accepting} onClick={() => void accept()}>
              Accept invitation
            </Button>
            <Button className="mt-2 w-full" variant="ghost" onClick={() => router.push(DOCUMENTS_PATH)} disabled={accepting}>
              Not now
            </Button>
          </div>
        )}

      </div>
    </main>
  );
}
