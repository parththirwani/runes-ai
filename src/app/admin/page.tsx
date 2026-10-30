"use client";

// App-admin console: found teams, read their rosters and documents, invite or remove members and
// read the audit trail. Every panel is fed by an admin-only endpoint, so a non-admin sees the same
// empty state as an admin with no data rather than a partial view. The lists are metadata only.
// Opening one document is the deliberate, audited content inspection the access plan defines
// (docs/workspaces-teams-access-plan.md, "separate, audited permission"): it returns the source as
// a read-only projection and writes an `document.inspect` audit row naming the actor. The UI says
// so on the button and on the panel, because the returned payload does contain document content.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { DOCUMENTS_PATH, SIGN_IN_PATH } from '@/src/lib/paths';
import Logo from '@/src/app/components/brand/logo';

type TeamRow = { id: string; name: string; memberCount: number; pendingInvitations: number; documentCount: number; archivedAt: string | null };
type MemberRow = { membershipId: string; userId: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; active: boolean; joinedAt: string; removedAt: string | null };
type DocumentRow = { id: string; title: string; format: string; updatedAt: string; author: { id: string; email: string; name: string } };
type AuditRow = { id: string; action: string; actor: { id: string; email: string; name: string } | null; targetUserId: string | null; documentId: string | null; createdAt: string };

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return data.error || data.message || fallback;
}

export default function AdminPage() {
  const router = useRouter();
  const { status } = useSession();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [inspected, setInspected] = useState<Record<string, unknown> | null>(null);
  const [teamName, setTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/teams');
      if (response.status === 403 || response.status === 404) {
        setDenied(true);
        return;
      }
      if (!response.ok) throw new Error(await readError(response, 'Could not load teams'));
      const data = await response.json();
      setTeams(data.teams ?? []);
      setSelectedTeam((current) => current ?? data.teams?.[0]?.id ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeam = useCallback(async (teamId: string) => {
    setError(null);
    setInspected(null);
    setInviteLink(null);
    try {
      const [detail, audit] = await Promise.all([
        fetch('/api/admin/teams/' + encodeURIComponent(teamId)),
        fetch('/api/admin/audit?teamId=' + encodeURIComponent(teamId)),
      ]);
      if (!detail.ok) throw new Error(await readError(detail, 'Could not load the team'));
      const data = await detail.json();
      // Removal keeps the row for the audit story, so the roster shows active people only.
      setMembers(((data.members ?? []) as MemberRow[]).filter((member) => member.active));
      setDocuments(data.documents?.rows ?? []);
      setEvents(audit.ok ? (await audit.json()).events ?? [] : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
      setMembers([]);
      setDocuments([]);
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(SIGN_IN_PATH + '?next=' + encodeURIComponent('/admin'));
    if (status === 'authenticated') void loadTeams();
  }, [status, loadTeams, router]);

  useEffect(() => {
    if (selectedTeam) void loadTeam(selectedTeam);
  }, [selectedTeam, loadTeam]);

  const createTeam = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not create the team'));
      const data = await response.json();
      if (data.team?.id) setSelectedTeam(data.team.id);
      setTeamName('');
      await loadTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create the team');
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    if (!selectedTeam) return;
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const response = await fetch('/api/teams/' + encodeURIComponent(selectedTeam) + '/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Could not send the invitation');
      setInviteEmail('');
      if (data.inviteUrl) setInviteLink(data.inviteUrl);
      await loadTeam(selectedTeam);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: MemberRow) => {
    if (!selectedTeam) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/teams/' + encodeURIComponent(selectedTeam) + '/members?membershipId=' + encodeURIComponent(member.membershipId), { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove that member'));
      await loadTeam(selectedTeam);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not remove that member');
    } finally {
      setBusy(false);
    }
  };

  const inspect = async (documentId: string) => {
    setError(null);
    try {
      const response = await fetch('/api/admin/documents/' + encodeURIComponent(documentId));
      if (!response.ok) throw new Error(await readError(response, 'Could not read that document'));
      setInspected(await response.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read that document');
      setInspected(null);
    }
  };

  if (status === 'loading' || (loading && !denied)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={DOCUMENTS_PATH} aria-label="Back to documents"><Logo variant="wordmark" size="sm" /></Link>
        <h1 className="text-lg font-semibold text-foreground">Admin</h1>
      </header>

      {denied && (
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <h2 className="text-base font-semibold text-foreground">Admin access is required</h2>
          <p className="mt-2 text-sm text-muted-foreground">This signed-in account is not an app admin. Ask an existing admin to provision it.</p>
        </div>
      )}

      {!denied && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <section aria-label="Teams" className="rounded-lg border border-border bg-surface p-4 lg:w-72 lg:shrink-0">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Teams</h2>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button type="button" onClick={() => setSelectedTeam(team.id)} aria-current={selectedTeam === team.id ? 'true' : undefined}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-raised ${selectedTeam === team.id ? 'bg-surface-raised text-foreground' : 'text-muted-foreground'}`}>
                      <span className="min-w-0 truncate">{team.name}</span>
                      <span className="shrink-0 font-mono text-xs text-meta">{team.memberCount} · {team.documentCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-4 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void createTeam(); }}>
              <label className="text-xs font-semibold uppercase tracking-wide text-meta" htmlFor="team-name">New team</label>
              <input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Research group" maxLength={60}
                className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-action focus:outline-none" />
              <button type="submit" disabled={busy || teamName.trim().length === 0}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-action px-3 text-sm font-medium text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}Create team
              </button>
            </form>
          </section>

          <section aria-label="Team detail" className="flex min-w-0 flex-1 flex-col gap-4">
            {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}

            {!selectedTeam ? (
              <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted-foreground">Pick a team to manage.</p>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-surface p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">Members</h2>
                  <form className="mb-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
                    <label className="sr-only" htmlFor="invite-email">Invited email address</label>
                    <input id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@university.edu"
                      className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus:border-action focus:outline-none" />
                    <button type="submit" disabled={busy || inviteEmail.trim().length === 0}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-raised">Invite</button>
                  </form>
                  {inviteLink && <p className="mb-3 break-all rounded-md bg-surface-raised px-3 py-2 text-xs text-muted-foreground">Invite link: {inviteLink}</p>}
                  <ul className="flex flex-col gap-1">
                    {members.map((member) => (
                      <li key={member.membershipId} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                        <span className="min-w-0 flex-1 truncate text-foreground">{member.email}</span>
                        <span className="shrink-0 text-xs text-meta">{member.role === 'ADMIN' ? 'Admin' : 'Member'}</span>
                        <button type="button" disabled={busy} onClick={() => void remove(member)} aria-label={`Remove ${member.email} from the team`}
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-meta hover:text-destructive disabled:opacity-50">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                    {members.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No members.</li>}
                  </ul>
                </div>

                <div className="rounded-lg border border-border bg-surface p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">Documents</h2>
                  <ul className="flex flex-col gap-1">
                    {documents.map((document) => (
                      <li key={document.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                        <span className="min-w-0 flex-1 truncate text-foreground">{document.title}</span>
                        <span className="shrink-0 text-xs text-meta">{document.author.email}</span>
                        <button type="button" onClick={() => void inspect(document.id)} aria-label={`View the source of ${document.title}. This action is recorded in the audit trail.`} className="shrink-0 text-xs font-medium text-action hover:underline">View source</button>
                      </li>
                    ))}
                    {documents.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No documents in this team.</li>}
                  </ul>
                  {inspected && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs text-meta">
                        Audited content inspection: this view includes the document source and was recorded in the trail below.
                      </p>
                      <pre className="max-h-64 overflow-auto rounded-md bg-surface-raised px-3 py-2 text-xs text-muted-foreground" aria-label="Audited document content, including source text">
                        {JSON.stringify(inspected.document ?? inspected, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-surface p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">Audit events</h2>
                  <ul className="flex flex-col gap-1">
                    {events.map((event) => (
                      <li key={event.id} className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-2 py-2 text-xs text-muted-foreground first:border-t-0">
                        <span className="min-w-0 flex-1 truncate">{event.action}</span>
                        <span className="shrink-0">{event.actor ? event.actor.email : 'system'}</span>
                        <time className="shrink-0 text-meta" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                      </li>
                    ))}
                    {events.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">Nothing recorded yet.</li>}
                  </ul>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
