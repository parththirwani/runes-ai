"use client";

import { Folder, FolderLock, Layers, Share2, Users, PencilLine, Plus } from "lucide-react";
import { scopeKey, type LibraryScope, type LibraryWorkspace } from "@/src/types/library";

interface WorkspaceNavProps {
  scope: LibraryScope;
  onScopeChange: (scope: LibraryScope) => void;
  workspaces: LibraryWorkspace[];
  pendingInvitations: number;
  onNewWorkspace: () => void;
  onRenameWorkspace: (workspace: LibraryWorkspace) => void;
  onShareWorkspace: (workspace: LibraryWorkspace) => void;
}

function itemClass(active: boolean): string {
  return `flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[15px] transition-colors hover:bg-surface-raised hover:text-foreground ${
    active ? "font-medium text-action" : "text-muted-foreground"
  }`;
}

/**
 * The library's scope picker. Everything shown is a collection the server already said this user
 * may open, and the counts come from the same response, so a workspace that exists but is not
 * readable simply is not listed. Team workspaces are labelled as read-shared because membership
 * is what grants the door, not a per-document share.
 */
export default function WorkspaceNav({
  scope,
  onScopeChange,
  workspaces,
  pendingInvitations,
  onNewWorkspace,
  onRenameWorkspace,
  onShareWorkspace,
}: WorkspaceNavProps) {
  const active = scopeKey(scope);

  return (
    <div className="px-2 pb-2">
      <p className="mb-1 mt-3 pl-3 text-xs font-semibold uppercase tracking-wide text-meta">Library</p>
      <button type="button" className={itemClass(active === "all")} aria-current={active === "all" ? "page" : undefined} onClick={() => onScopeChange({ kind: "all" })}>
        <span className="flex items-center gap-2"><Layers size={17} aria-hidden="true" />All documents</span>
      </button>
      <button type="button" className={itemClass(active === "shared")} aria-current={active === "shared" ? "page" : undefined} onClick={() => onScopeChange({ kind: "shared" })}>
        <span className="flex items-center gap-2"><Share2 size={17} aria-hidden="true" />Shared with me</span>
        {pendingInvitations > 0 && (
          <span className="min-w-5 rounded-full bg-primary-subtle px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-primary" title={`${pendingInvitations} pending invitations`}>
            {pendingInvitations}
          </span>
        )}
      </button>

      <div className="mx-1 mt-4 border-t border-border" />
      <div className="mb-1 mt-3 flex items-center justify-between pl-3 pr-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-meta">Workspaces</p>
        <button type="button" onClick={onNewWorkspace} aria-label="New workspace" className="inline-flex size-8 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground">
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>

      <ul className="space-y-0.5">
        {workspaces.length === 0 && <li className="px-2 py-2 text-sm text-meta">No workspaces loaded yet.</li>}
        {workspaces.map((workspace) => {
          const key = `workspace:${workspace.id}`;
          const isActive = active === key;
          const isTeam = workspace.kind === "TEAM";
          return (
            <li key={workspace.id} className="group">
              <div className="flex items-center gap-1">
                <button type="button" className={itemClass(isActive)} aria-current={isActive ? "page" : undefined} onClick={() => onScopeChange({ kind: "workspace", id: workspace.id, name: workspace.name })}>
                  <span className="flex min-w-0 items-center gap-2">
                    {isTeam ? <Users size={17} aria-hidden="true" /> : <Folder size={17} aria-hidden="true" />}
                    <span className="truncate">{workspace.name}</span>
                  </span>
                  <span className="min-w-5 text-right font-mono text-xs tabular-nums text-meta">{workspace.documentCount}</span>
                </button>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" style={isActive ? { opacity: 1 } : undefined}>
                  {workspace.capabilities.canRename && (
                    <button type="button" onClick={() => onRenameWorkspace(workspace)} aria-label={`Rename ${workspace.name}`} className="inline-flex size-8 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground">
                      <PencilLine size={14} aria-hidden="true" />
                    </button>
                  )}
                  {workspace.capabilities.canShare && !isTeam && (
                    <button type="button" onClick={() => onShareWorkspace(workspace)} aria-label={`Share ${workspace.name}`} className="inline-flex size-8 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground">
                      <Share2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {isTeam && (
                <p className="ml-8 flex items-center gap-1 text-[11px] text-meta">
                  <FolderLock size={11} aria-hidden="true" />
                  Shared with every {workspace.teamName ?? "team"} member, read only
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
