"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, Plus, UsersRound } from "lucide-react";
import { DOCUMENT_PATH, DOCUMENTS_PATH, SIGN_IN_PATH } from "@/src/lib/paths";
import type { DocumentFormatValue } from "@/src/types/compilation";
import CreateDocumentModal from "@/src/app/components/dashboard/createDocumentModal";
import Modal from "@/src/app/components/design/Modal";
import Button from "@/src/app/components/design/Button";
import HoldToConfirm from "@/components/arc/hold-to-confirm/hold-to-confirm";

type Team = { id: string; name: string; role: "ADMIN" | "MEMBER"; workspaceId: string | null; archivedAt: string | null };
type Member = { membershipId: string; userId: string; email: string; name: string; role: "ADMIN" | "MEMBER" };
type Invitation = { id: string; email: string; status: string; expiresAt: string };
type TeamDocument = { id: string; title: string; format: "LATEX" | "MARKDOWN"; authorName: string; access: "Edit" | "View" };

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error || data.message || fallback;
}

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [documents, setDocuments] = useState<TeamDocument[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [showCreateDocument, setShowCreateDocument] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teamResponse = await fetch("/api/teams");
      if (!teamResponse.ok) throw new Error(await responseError(teamResponse, "Could not load teams"));
      const teamList = (await teamResponse.json()).teams as Team[];
      const found = teamList.find((entry) => entry.id === id && entry.workspaceId);
      if (!found || !found.workspaceId) {
        setTeam(null);
        return;
      }
      const [documentResponse, memberResponse] = await Promise.all([
        fetch(`/api/workspaces/${encodeURIComponent(found.workspaceId)}/documents`),
        found.role === "ADMIN" ? fetch(`/api/teams/${encodeURIComponent(id)}/members`) : Promise.resolve(null),
      ]);
      if (!documentResponse.ok) throw new Error(await responseError(documentResponse, "Could not load team documents"));
      if (memberResponse && !memberResponse.ok) throw new Error(await responseError(memberResponse, "Could not load team members"));
      setTeam(found);
      setDocuments((await documentResponse.json()).documents ?? []);
      if (memberResponse) {
        const data = await memberResponse.json();
        setMembers(data.members ?? []);
        setInvitations(data.invitations ?? []);
      } else {
        setMembers([]);
        setInvitations([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the team");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace(`${SIGN_IN_PATH}?next=${encodeURIComponent(`/teams/${id}`)}`);
    if (status === "authenticated") void load();
  }, [status, id, load, router]);

  const createDocument = async (title: string, format: DocumentFormatValue) => {
    if (!team?.workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(team.workspaceId)}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, format }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not create document"));
      const data = await response.json();
      setShowCreateDocument(false);
      router.push(DOCUMENT_PATH(data.document.id));
    } catch (cause) {
      setShowCreateDocument(false);
      setError(cause instanceof Error ? cause.message : "Could not create document");
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    if (!team) return;
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(team.id)}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not invite member"));
      const data = await response.json();
      setInviteEmail("");
      if (data.inviteUrl) setInviteLink(data.inviteUrl);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not invite member");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!team || !removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const url = `/api/teams/${encodeURIComponent(team.id)}/members?membershipId=${encodeURIComponent(removeTarget.membershipId)}`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not remove member"));
      setRemoveTarget(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading" || loading) return <main className="flex min-h-screen items-center justify-center bg-canvas"><Loader2 className="size-5 animate-spin text-meta" aria-label="Loading team" /></main>;

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 text-foreground">
      <Link href={DOCUMENTS_PATH} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />Back to documents</Link>
      {error && <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}
      {!team ? <div className="rounded-lg border border-border bg-surface p-6">Team not found or you no longer have access.</div> : <>
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs text-meta"><UsersRound className="size-4" aria-hidden="true" />Team dashboard · {team.role === "ADMIN" ? "Admin" : "Member"}</p>
            <h1 className="text-2xl font-semibold">{team.name}</h1>
          </div>
          <button type="button" onClick={() => setShowCreateDocument(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-action px-3 text-sm font-medium text-white"><Plus className="size-4" aria-hidden="true" />New document</button>
        </header>
        <p className="mb-5 text-sm text-muted-foreground">Team members can read every document here. Authors edit their own documents.</p>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label="Team documents" className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-base font-semibold">Documents</h2>
            {documents.length === 0 ? <p className="text-sm text-muted-foreground">No team documents yet.</p> : <ul className="space-y-1">
              {documents.map((document) => <li key={document.id}>
                <Link href={DOCUMENT_PATH(document.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                  <span className="min-w-0 truncate font-medium">{document.title}</span>
                  <span className="text-xs text-meta">{document.authorName} · {document.format === "MARKDOWN" ? "Markdown" : "LaTeX"} · {document.access}</span>
                </Link>
              </li>)}
            </ul>}
          </section>
          <section aria-label="Team members" className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-base font-semibold">Members</h2>
            {team.role === "ADMIN" ? <>
              <form onSubmit={(event) => { event.preventDefault(); void invite(); }} className="mb-3 flex gap-2">
                <label className="sr-only" htmlFor="team-invite-email">Email address</label>
                <input id="team-invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Email address"
                  className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm" />
                <button type="submit" disabled={busy || !inviteEmail.trim()} className="rounded-md border border-border px-3 text-sm disabled:opacity-50">Invite</button>
              </form>
              {inviteLink && <p className="mb-3 break-all rounded-md bg-surface-raised p-2 text-xs">Share this invite link: {inviteLink}</p>}
              <ul className="space-y-1">{members.map((member) => <li key={member.membershipId} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={member.email}>{member.name || member.email}</span>
                <span className="text-xs text-meta">{member.role === "ADMIN" ? "Admin" : "Member"}</span>
                <button type="button" onClick={() => setRemoveTarget(member)} className="text-xs text-destructive hover:underline" aria-label={`Remove ${member.email}`}>Remove</button>
              </li>)}</ul>
              {invitations.some((invitation) => invitation.status === "PENDING") && <div className="mt-4 border-t border-border pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase text-meta">Pending invites</h3>
                {invitations.filter((invitation) => invitation.status === "PENDING").map((invitation) => <p key={invitation.id} className="py-1 text-xs text-muted-foreground">{invitation.email}</p>)}
              </div>}
            </> : <p className="text-sm text-muted-foreground">Team admins manage invitations and members.</p>}
          </section>
        </div>
      </>}

      <CreateDocumentModal isOpen={showCreateDocument} onClose={() => setShowCreateDocument(false)} onSubmit={(title, format) => void createDocument(title, format)}
        isLoading={busy} existingTitles={documents.map((document) => document.title)} workspaceName={team?.name} />
      <Modal isOpen={removeTarget !== null} onClose={() => { if (!busy) setRemoveTarget(null); }} title={`Remove ${removeTarget?.name || removeTarget?.email || "member"}?`} size="sm"
        footer={<><Button variant="ghost" disabled={busy} onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <HoldToConfirm label="Hold to remove member" confirmedLabel="Removing…" tone="danger" confirmed={busy} disabled={busy} onConfirm={() => void remove()} />
        </>}>
        <p className="text-sm text-muted-foreground">Their access to team documents ends on the next request. Documents they authored stay in the team.</p>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </Modal>
    </main>
  );
}
