"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

/**
 * Chooses the library scope. The list comes straight from the server, so a workspace that was
 * just shared with the user -- or a team they were just removed from -- appears or disappears on
 * the next load rather than being cached here.
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: "PERSONAL" | "TEAM";
  isDefault: boolean;
  teamId: string | null;
  teamName: string | null;
  documentCount: number;
  access: "owner" | "member" | "viewer";
  canCreate: boolean;
  canShare: boolean;
  canRename: boolean;
  canManageTeam: boolean;
};

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  selectedId: string | null;
  onSelect: (workspaceId: string | null) => void;
  onCreate: (name: string) => Promise<string | null>;
  labelledBy?: string;
}

function optionLabel(workspace: WorkspaceSummary) {
  const access = workspace.access === "owner" ? "" : workspace.access === "member" ? " · team" : " · shared";
  const count = ` (${workspace.documentCount})`;
  return `${workspace.name}${access}${count}`;
}

export default function WorkspaceSwitcher({ workspaces, selectedId, onSelect, onCreate, labelledBy = "workspace-scope" }: WorkspaceSwitcherProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owned = workspaces.filter((workspace) => workspace.access === "owner");
  const teamed = workspaces.filter((workspace) => workspace.access === "member");
  const shared = workspaces.filter((workspace) => workspace.access === "viewer");
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const message = await onCreate(name);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setName("");
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label id={labelledBy} htmlFor="workspace-select" className="sr-only">Current workspace</label>
        <select id="workspace-select" aria-labelledby={labelledBy} value={selectedId ?? ""} onChange={(event) => onSelect(event.target.value || null)}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground focus:border-action focus:outline-none">
          <option value="">All workspaces ({workspaces.reduce((total, workspace) => total + workspace.documentCount, 0)})</option>
          {owned.length > 0 && <optgroup label="Yours">{owned.map((workspace) => <option key={workspace.id} value={workspace.id}>{optionLabel(workspace)}</option>)}</optgroup>}
          {teamed.length > 0 && <optgroup label="Teams">{teamed.map((workspace) => <option key={workspace.id} value={workspace.id}>{optionLabel(workspace)}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label="Shared with you">{shared.map((workspace) => <option key={workspace.id} value={workspace.id}>{optionLabel(workspace)}</option>)}</optgroup>}
        </select>
        <button type="button" onClick={() => { setCreating((value) => !value); setError(null); }} aria-expanded={creating}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-raised">
          <Plus className="size-4" aria-hidden="true" />New
        </button>
      </div>

      {creating && (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Course, project, lab…" maxLength={60}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none" />
          <button type="submit" disabled={busy || name.trim().length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-action px-3 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Create
          </button>
        </form>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-subtle px-2.5 py-2 text-xs text-destructive">{error}</p>}
      {selected && !selected.canCreate && (
        <p className="rounded-md border border-border-subtle bg-surface-raised px-2.5 py-2 text-xs text-muted-foreground">
          You have view access here, so new documents stay in a workspace you can author in.
        </p>
      )}
    </div>
  );
}
