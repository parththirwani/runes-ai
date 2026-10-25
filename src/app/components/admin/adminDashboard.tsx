"use client";

// App-admin console: teams, their members and documents, and the audit trail.
//
// Everything here is a thin client over the admin APIs, which decide access again on every call.
// The page that mounts this component already checked the database flag; if a flag is revoked
// while the tab stays open, the next request fails and the table below says so rather than
// pretending the data is still there.

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import Button from "@/src/app/components/design/Button";
import ConfirmModal from "@/src/app/components/design/ConfirmModal";
import InputModal from "@/src/app/components/design/InputModal";
import Modal from "@/src/app/components/design/Modal";

type TeamRow = {
  id: string;
  name: string;
  archivedAt: string | null;
  memberCount: number;
  activeMemberCount: number;
  adminCount: number;
  pendingInvitations: number;
  workspaceId: string | null;
  workspaceName: string | null;
  documentCount: number;
};

type MemberRow = {
  id: string;
  userId: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  joinedAt: string;
  name: string;
  email: string;
};

type DocumentRow = {
  id: string;
  title: string;
  slug: string;
  format: string;
  updatedAt: string;
  author: { id: string; name: string; email: string };
};

type TeamDetail = {
  team: {
    id: string;
    name: string;
    archivedAt: string | null;
    workspace: { id: string; name: string } | null;
    members: MemberRow[];
    invitations: { id: string; email: string; role: string; status: string; expiresAt: string | null }[];
    documents: DocumentRow[];
  };
};

type AuditEvent = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; email: string };
  teamId: string | null;
  documentId: string | null;
  targetUserId: string | null;
  metadata: unknown;
};

type Inspection = {
  document: {
    id: string;
    title: string;
    format: string;
    mainFilePath: string;
    author: { name: string; email: string };
    mainSource: string;
    readOnly: true;
  };
};

function when(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

async function message(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<"teams" | "audit">("teams");
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [removal, setRemoval] = useState<MemberRow | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const pageSize = 25;

  const loadTeams = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/teams?page=" + page + "&pageSize=" + pageSize);
      if (!response.ok) throw new Error(await message(response, "This console is not available for your account."));
      const data = await response.json();
      setTeams(data.teams ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load teams");
    }
  }, [page]);

  const loadDetail = useCallback(async (teamId: string) => {
    try {
      const response = await fetch("/api/admin/teams/" + teamId);
      if (!response.ok) throw new Error(await message(response, "Could not open this team."));
      setDetail((await response.json()) as TeamDetail);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open this team");
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/audit?page=" + page + "&pageSize=" + pageSize + (selected ? "&teamId=" + selected : ""));
      if (!response.ok) throw new Error(await message(response, "Could not load the audit trail."));
      const data = await response.json();
      setEvents(data.events ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the audit trail");
    }
  }, [page, selected]);

  useEffect(() => {
    void (tab === "audit" ? loadAudit() : loadTeams());
  }, [tab, loadAudit, loadTeams]);

  useEffect(() => {
    if (selected && tab === "teams") void loadDetail(selected);
  }, [selected, tab, loadDetail]);

  const createTeam = async (name: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await message(response, "Could not create the team."));
      const data = await response.json();
      setCreateOpen(false);
      setNotice("Team created. Its default workspace is shared with every member, read only.");
      setSelected(data.team?.id ?? null);
      await loadTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create the team");
    } finally {
      setBusy(false);
    }
  };

  const inviteMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/teams/" + selected + "/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!response.ok) throw new Error(await message(response, "Could not invite that address."));
      const data = await response.json();
      setInviteEmail("");
      const delivery = (data.invitation as { delivery?: { channel?: string } } | null)?.delivery;
      setNotice(
        delivery?.channel === "development-link"
          ? "Invitation created. Delivery is local in this environment, so open the link from the inviter's session."
          : delivery?.channel === "unavailable"
            ? "Invitation created but not delivered: configure an email provider."
            : "Invitation sent.",
      );
      await loadDetail(selected);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not invite that address");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async () => {
    if (!selected || !removal) return;
    setBusy(true);
    try {
      const response = await fetch("/api/teams/" + selected + "/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: removal.id }),
      });
      if (!response.ok) throw new Error(await message(response, "Could not remove that member."));
      setRemoval(null);
      setNotice(removal.name + " lost access to the team workspace on their next request.");
      await loadDetail(selected);
      await loadTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not remove that member");
    } finally {
      setBusy(false);
    }
  };

  const inspect = async (documentId: string) => {
    try {
      const response = await fetch("/api/admin/documents/" + documentId + "/inspect");
      if (!response.ok) throw new Error(await message(response, "Could not open this document."));
      setInspection((await response.json()) as Inspection);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open this document");
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const members = detail?.team.members.filter((member) => member.active) ?? [];
  const admins = members.filter((member) => member.role === "ADMIN");

  return (
    <main id="main" className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface px-5 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-action" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground">Administration</h1>
          </div>
          <nav className="flex items-center gap-1 rounded border border-border bg-surface-raised p-0.5" aria-label="Admin sections">
            <button type="button" onClick={() => { setTab("teams"); setPage(1); }} aria-current={tab === "teams" ? "page" : undefined}
              className={"rounded px-3 py-1 text-sm " + (tab === "teams" ? "bg-action text-white" : "text-muted-foreground hover:text-foreground")}>
              Teams
            </button>
            <button type="button" onClick={() => { setTab("audit"); setPage(1); }} aria-current={tab === "audit" ? "page" : undefined}
              className={"rounded px-3 py-1 text-sm " + (tab === "audit" ? "bg-action text-white" : "text-muted-foreground hover:text-foreground")}>
              Audit history
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {error && (
          <p role="alert" className="mb-4 flex items-center gap-2 rounded border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{error}
          </p>
        )}
        {notice && <p role="status" className="mb-4 rounded border border-border bg-surface-raised px-3 py-2 text-sm text-muted-foreground">{notice}</p>}

        {tab === "teams" && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <section aria-label="Teams">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-meta">Teams</h2>
                <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>New team</Button>
              </div>
              <ul className="space-y-1">
                {teams.length === 0 && <li className="text-sm text-meta">No teams yet.</li>}
                {teams.map((team) => (
                  <li key={team.id}>
                    <button type="button" onClick={() => setSelected(team.id)}
                      className={"min-h-11 w-full rounded border px-3 py-2 text-left text-sm transition-colors " + (selected === team.id ? "border-action bg-primary-subtle text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-surface-raised")}>
                      <span className="block truncate font-medium text-foreground">{team.name}</span>
                      <span className="block text-[11px] text-meta">{team.activeMemberCount} members · {team.documentCount} documents</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Team detail" className="min-w-0">
              {!detail && <p className="text-sm text-muted-foreground">Choose a team to manage its members and see its documents.</p>}

              {detail && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{detail.team.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Default workspace: {detail.team.workspace?.name ?? "none"}. Every active member can open these documents; only the author of one can change it.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-meta">Members ({members.length})</h3>
                    <table className="w-full border-collapse overflow-hidden rounded border border-border text-sm">
                      <thead className="bg-surface-raised text-left text-xs text-meta">
                        <tr>
                          <th className="px-3 py-2 font-medium">Member</th>
                          <th className="px-3 py-2 font-medium">Role</th>
                          <th className="px-3 py-2 font-medium">Joined</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {members.map((member) => (
                          <tr key={member.id} className="bg-surface">
                            <td className="px-3 py-2"><span className="block truncate text-foreground">{member.name}</span><span className="block truncate text-[11px] text-meta">{member.email}</span></td>
                            <td className="px-3 py-2 text-muted-foreground">{member.role === "ADMIN" ? "Admin" : "Member"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{when(member.joinedAt)}</td>
                            <td className="px-3 py-2 text-right">
                              <Button size="sm" variant="ghost" onClick={() => setRemoval(member)}
                                disabled={member.role === "ADMIN" && admins.length <= 1}
                                title={member.role === "ADMIN" && admins.length <= 1 ? "A team keeps at least one admin" : "Remove from team"}>
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <form onSubmit={(event) => void inviteMember(event)} className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1">
                        <label htmlFor="invite-email" className="mb-1 block text-xs font-medium text-muted-foreground">Invite a member</label>
                        <input id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com"
                          className="h-10 w-full rounded border border-input bg-surface px-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none focus-visible:ring-2 focus-visible:ring-action/25" />
                      </div>
                      <div>
                        <label htmlFor="invite-role" className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
                        <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "MEMBER")}
                          className="h-10 rounded border border-input bg-surface px-3 text-sm text-foreground focus:border-action focus:outline-none">
                          <option value="MEMBER">Member</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </div>
                      <Button type="submit" loading={busy} disabled={!inviteEmail.trim()}>Send invite</Button>
                    </form>
                    <p className="mt-2 text-xs text-meta">An invitation grants nothing until that person accepts it. Admins can manage members; members only read the team workspace.</p>

                    {detail.team.invitations.filter((invitation) => invitation.status === "PENDING").length > 0 && (
                      <p className="mt-2 text-xs text-meta">
                        Pending: {detail.team.invitations.filter((invitation) => invitation.status === "PENDING").map((invitation) => invitation.email + " (" + invitation.role.toLowerCase() + ")").join(", ")}
                      </p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-meta">Documents ({detail.team.documents.length})</h3>
                    <table className="w-full border-collapse overflow-hidden rounded border border-border text-sm">
                      <thead className="bg-surface-raised text-left text-xs text-meta">
                        <tr>
                          <th className="px-3 py-2 font-medium">Title</th>
                          <th className="px-3 py-2 font-medium">Author</th>
                          <th className="px-3 py-2 font-medium">Updated</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {detail.team.documents.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-meta">This workspace has no documents yet.</td></tr>}
                        {detail.team.documents.map((document) => (
                          <tr key={document.id} className="bg-surface">
                            <td className="px-3 py-2 truncate text-foreground">{document.title}</td>
                            <td className="px-3 py-2 text-muted-foreground">{document.author.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{when(document.updatedAt)}</td>
                            <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => void inspect(document.id)}>Inspect</Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-meta">Inspecting opens the main source read only and records an audit event naming you.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "audit" && (
          <section aria-label="Audit history">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-meta">
              Audit history{selected ? " for the selected team" : ""} ({total})
            </h2>
            <table className="w-full border-collapse overflow-hidden rounded border border-border text-sm">
              <thead className="bg-surface-raised text-left text-xs text-meta">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">About</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {events.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-meta">Nothing recorded yet.</td></tr>}
                {events.map((event) => (
                  <tr key={event.id} className="bg-surface">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{when(event.createdAt)}</td>
                    <td className="px-3 py-2"><code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-foreground">{event.action}</code></td>
                    <td className="px-3 py-2 text-muted-foreground">{event.actor.email}</td>
                    <td className="px-3 py-2 text-[11px] text-meta">{event.documentId ? "document " + event.documentId : event.teamId ? "team " + event.teamId : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </span>
        </div>
      </div>

      <InputModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onSubmit={(name) => void createTeam(name)} title="New team" label="Team name"
        description="A team gets one default workspace, shared read only with every member." submitText="Create team" maxLength={60} isLoading={busy} />

      <ConfirmModal isOpen={removal !== null} onClose={() => setRemoval(null)} onConfirm={() => void removeMember()} isLoading={busy}
        variant="danger" title="Remove this member?" confirmText="Remove member"
        message={removal
          ? removal.name + " stops seeing the team workspace and every document in it on their next request. Documents they wrote stay theirs."
          : ""} />

      <Modal isOpen={inspection !== null} onClose={() => setInspection(null)} title={inspection?.document.title ?? "Document"} size="lg"
        description={inspection ? "Author: " + inspection.document.author.name + " · " + inspection.document.format + " · main file " + inspection.document.mainFilePath + " · read only" : ""}>
        <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-surface-raised p-3 font-mono text-[11px] leading-5 text-foreground">{inspection?.document.mainSource}</pre>
      </Modal>
    </main>
  );
}
