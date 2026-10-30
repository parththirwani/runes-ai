"use client";

import { useReducer, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Copy, Folder, Loader2, MoreHorizontal, Pencil, Plus, Trash2, UsersRound, X } from "lucide-react";
import Button from "../design/Button";
import Modal from "../design/Modal";
import HoldToConfirm from "@/components/arc/hold-to-confirm/hold-to-confirm";
import { DOCUMENT_PATH } from "@/src/lib/paths";
import { initialWorkspacePanelState, workspacePanelReducer } from "@/src/lib/workspace-panel-state";

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

export type SidebarDocument = { id: string; title: string; workspaceId: string; updatedAt: string };
export type WorkspaceTarget = Pick<WorkspaceSummary, "id" | "name">;

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  documents: SidebarDocument[];
  selectedId: string | null;
  onSelect: (workspaceId: string) => void;
  onOpenDocument: (document: SidebarDocument) => void;
  onCreate: (name: string) => Promise<string | null>;
  onAddDocument: (workspace: WorkspaceTarget) => void;
  onRename: (workspaceId: string, name: string) => Promise<string | null>;
  onDelete: (workspaceId: string) => Promise<string | null>;
  labelledBy?: string;
}

const PREVIEW_COUNT = 5;
const menuItemClass = "flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface-raised";
const narrowScreenQuery = "(max-width: 500px)";

function subscribeNarrowScreen(notify: () => void) {
  const query = window.matchMedia(narrowScreenQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function narrowScreenSnapshot() {
  return window.matchMedia(narrowScreenQuery).matches;
}

export default function WorkspaceSwitcher({ workspaces, documents, selectedId, onSelect, onOpenDocument, onCreate, onAddDocument, onRename, onDelete, labelledBy = "workspace-scope" }: WorkspaceSwitcherProps) {
  const [panel, dispatchPanel] = useReducer(workspacePanelReducer, initialWorkspacePanelState);
  const { creating, sectionExpanded, name } = panel;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null);
  const [showMoreIds, setShowMoreIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const narrowScreen = useSyncExternalStore(subscribeNarrowScreen, narrowScreenSnapshot, () => false);

  // The default personal collection remains available through Documents. The project list shows
  // named collections, including team and shared workspaces, without an "All workspaces" row.
  const listed = workspaces.filter((workspace) => !(workspace.kind === "PERSONAL" && workspace.isDefault && workspace.access === "owner"));

  const submitCreate = async () => {
    setBusy(true);
    setError(null);
    const message = await onCreate(name);
    setBusy(false);
    if (message) { setError(message); return; }
    dispatchPanel({ type: "create-succeeded" });
  };

  const submitRename = async (workspaceId: string) => {
    setBusy(true);
    setError(null);
    const message = await onRename(workspaceId, renameName);
    setBusy(false);
    if (message) { setError(message); return; }
    setRenamingId(null);
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    const message = await onDelete(deleteTarget.id);
    setBusy(false);
    if (message) { setError(message); return; }
    setDeleteTarget(null);
  };

  const copyDocumentLink = async (document: SidebarDocument) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${DOCUMENT_PATH(document.id)}`);
    } catch {
      setError("Could not copy the document link");
    }
  };

  return (
    <section aria-labelledby={labelledBy}>
      <div className="mb-1 flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 id={labelledBy} className="min-w-0 flex-1 text-xs font-medium text-meta">
          <button type="button" aria-label={sectionExpanded ? "Collapse workspaces" : "Expand workspaces"} aria-expanded={sectionExpanded} aria-controls="workspace-list"
            onClick={() => dispatchPanel({ type: "toggle-section" })} className="flex min-h-8 w-full items-center gap-1 rounded-md text-left hover:text-foreground">
            <ChevronDown className={`size-3.5 shrink-0 transition-transform ${sectionExpanded ? "" : "-rotate-90"}`} aria-hidden="true" />Workspaces
          </button>
        </h2>
        <button type="button" aria-label="New workspace" title="New workspace" onClick={() => { dispatchPanel({ type: "toggle-create" }); setError(null); }} aria-expanded={creating}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-meta hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-action">
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div id="workspace-list" hidden={!sectionExpanded}>
      {creating && (
        <form className="mb-2 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void submitCreate(); }}>
          <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" value={name} onChange={(event) => dispatchPanel({ type: "set-name", value: event.target.value })} placeholder="Workspace name" maxLength={60}
            className="min-h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none" />
          <button type="submit" disabled={busy || name.trim().length === 0}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-action px-3 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Create workspace
          </button>
        </form>
      )}

      {listed.length === 0 && !creating && <p className="px-2 py-2 text-xs text-meta">No workspaces yet</p>}
      <ul className="space-y-1">
        {listed.map((workspace) => {
          const workspaceDocuments = documents.filter((document) => document.workspaceId === workspace.id);
          const expanded = showMoreIds.has(workspace.id);
          const shownDocuments = expanded ? workspaceDocuments : workspaceDocuments.slice(0, PREVIEW_COUNT);
          const documentsExpanded = !collapsedIds.has(workspace.id);
          const canDelete = workspace.access === "owner" && workspace.kind === "PERSONAL" && !workspace.isDefault;
          const hasMenu = workspace.canCreate || workspace.canRename || canDelete || Boolean(workspace.teamId);

          return (
            <li key={workspace.id}>
              <div className={`group flex min-h-9 items-center rounded-md px-1 hover:bg-surface-raised ${selectedId === workspace.id ? "bg-action-soft" : ""}`}>
                <button type="button" aria-label={documentsExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`} aria-expanded={documentsExpanded}
                  aria-controls={`workspace-documents-${workspace.id}`}
                  onClick={() => setCollapsedIds((current) => { const next = new Set(current); if (next.has(workspace.id)) next.delete(workspace.id); else next.add(workspace.id); return next; })}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-meta hover:text-foreground focus-visible:outline-2 focus-visible:outline-action">
                  <ChevronDown className={`size-3.5 transition-transform ${documentsExpanded ? "" : "-rotate-90"}`} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => onSelect(workspace.id)} aria-current={selectedId === workspace.id ? "page" : undefined}
                  title={workspace.kind === "TEAM" ? `${workspace.name} · team` : workspace.access === "viewer" ? `${workspace.name} · shared` : workspace.name}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-2 text-left text-sm ${selectedId === workspace.id ? "font-medium text-action" : "text-foreground"}`}>
                  {workspace.kind === "TEAM" ? <UsersRound className="size-4 shrink-0 text-meta" aria-hidden="true" /> : <Folder className="size-4 shrink-0 text-meta" aria-hidden="true" />}
                  <span className="min-w-0 truncate">{workspace.name}</span>
                </button>
                {hasMenu && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button type="button" aria-label={`Actions for ${workspace.name}`} title={`Actions for ${workspace.name}`}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-meta opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-action [@media(hover:none)]:opacity-100">
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content side={narrowScreen ? "bottom" : "right"} align={narrowScreen ? "end" : "start"} sideOffset={6}
                        avoidCollisions={narrowScreen} collisionPadding={8}
                        className="z-[60] min-w-44 rounded-md border border-border bg-surface-overlay p-1 shadow-overlay">
                        {workspace.canCreate && <DropdownMenu.Item className={menuItemClass} onSelect={() => onAddDocument(workspace)}><Plus className="size-4 text-meta" aria-hidden="true" />Add document</DropdownMenu.Item>}
                        {workspace.teamId && <DropdownMenu.Item asChild className={menuItemClass}>
                          <Link href={`/teams/${encodeURIComponent(workspace.teamId)}`}><UsersRound className="size-4 text-meta" aria-hidden="true" />{workspace.canManageTeam ? "Manage team" : "Team dashboard"}</Link>
                        </DropdownMenu.Item>}
                        {workspace.canRename && <DropdownMenu.Item className={menuItemClass} onSelect={() => { setRenamingId(workspace.id); setRenameName(workspace.name); setError(null); }}><Pencil className="size-4 text-meta" aria-hidden="true" />Rename workspace</DropdownMenu.Item>}
                        {canDelete && <DropdownMenu.Item className={`${menuItemClass} text-destructive`} onSelect={() => { setDeleteTarget(workspace); setError(null); }}><Trash2 className="size-4" aria-hidden="true" />Delete workspace</DropdownMenu.Item>}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </div>

              {renamingId === workspace.id && (
                <form className="mb-1 flex items-center gap-1 pl-6" onSubmit={(event) => { event.preventDefault(); void submitRename(workspace.id); }}>
                  <label className="sr-only" htmlFor={`rename-${workspace.id}`}>New name for {workspace.name}</label>
                  <input id={`rename-${workspace.id}`} autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={60}
                    className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:border-action focus:outline-none" />
                  <button type="submit" disabled={busy || !renameName.trim()} aria-label={`Save name for ${workspace.name}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded text-action disabled:opacity-50"><Check className="size-4" /></button>
                  <button type="button" aria-label="Cancel rename" onClick={() => { setRenamingId(null); setError(null); }} className="inline-flex size-8 shrink-0 items-center justify-center rounded text-meta"><X className="size-4" /></button>
                </form>
              )}

              <ul id={`workspace-documents-${workspace.id}`} hidden={!documentsExpanded} className="ml-6 border-l border-border-subtle pl-2">
                {shownDocuments.length === 0 && <li className="px-2 py-1.5 text-xs text-meta">No documents</li>}
                {shownDocuments.map((document) => (
                  <li key={document.id}>
                    <div className="group flex min-h-8 items-center rounded-md hover:bg-surface-raised">
                      <button type="button" title={document.title} onClick={() => onOpenDocument(document)}
                        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground">
                        {document.title}
                      </button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button type="button" aria-label={`Actions for ${document.title}`} title={`Actions for ${document.title}`}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-meta opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-action [@media(hover:none)]:opacity-100">
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content side={narrowScreen ? "bottom" : "right"} align={narrowScreen ? "end" : "start"} sideOffset={6}
                            avoidCollisions={narrowScreen} collisionPadding={8}
                            className="z-[60] min-w-40 rounded-md border border-border bg-surface-overlay p-1 shadow-overlay">
                            <DropdownMenu.Item className={menuItemClass} onSelect={() => onOpenDocument(document)}><Folder className="size-4 text-meta" aria-hidden="true" />Open document</DropdownMenu.Item>
                            <DropdownMenu.Item className={menuItemClass} onSelect={() => void copyDocumentLink(document)}><Copy className="size-4 text-meta" aria-hidden="true" />Copy link</DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  </li>
                ))}
                {workspaceDocuments.length > PREVIEW_COUNT && (
                  <li><button type="button" onClick={() => setShowMoreIds((current) => { const next = new Set(current); if (next.has(workspace.id)) next.delete(workspace.id); else next.add(workspace.id); return next; })}
                    className="rounded-md px-2 py-1.5 text-left text-xs text-meta hover:text-foreground">{expanded ? "Show less" : `Show more (${workspaceDocuments.length - PREVIEW_COUNT})`}</button></li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>

      {error && !deleteTarget && <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive-subtle px-2.5 py-2 text-xs text-destructive">{error}</p>}
      </div>

      <Modal isOpen={deleteTarget !== null} onClose={() => { if (!busy) { setDeleteTarget(null); setError(null); } }} title={`Delete ${deleteTarget?.name ?? "workspace"}?`} size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => { setDeleteTarget(null); setError(null); }} disabled={busy}>Cancel</Button>
          <HoldToConfirm label="Hold to delete workspace" confirmedLabel="Deleting…" tone="danger" confirmed={busy}
            disabled={busy || (deleteTarget?.documentCount ?? 0) > 0} onConfirm={() => void submitDelete()} />
        </>}>
        <p className="text-sm text-muted-foreground">
          {deleteTarget && deleteTarget.documentCount > 0
            ? `Move or delete the ${deleteTarget.documentCount} ${deleteTarget.documentCount === 1 ? "document" : "documents"} in this workspace first.`
            : "This removes the empty workspace and its sharing access. This cannot be undone."}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </Modal>
    </section>
  );
}
