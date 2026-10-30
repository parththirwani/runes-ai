"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, ChevronDown, Folder, Menu, Plus, Search, Star, TriangleAlert, UsersRound, X } from "lucide-react";
import { useDashboard, type DashboardDocument } from "@/src/hooks/useDashboard";
import { DOCUMENT_PATH, DOCUMENTS_PATH, type CreateFormat } from "@/src/lib/paths";
import { documentAccessLabel, documentFormatLabel, documentOpenPath, documentOwnerLabel, documentWorkspaceLabel, selectLibraryDocuments, type LibraryFilter } from "@/src/lib/dashboard-library";
import UserMenu from "@/components/arc/user-menu/user-menu";
import AlertModal from "../design/AlertModal";
import Logo from "../brand/logo";
import CreateDocumentModal from "./createDocumentModal";
import DocumentActions from "./documentActions";
import WorkspaceSwitcher, { type WorkspaceTarget } from "./workspaceSwitcher";
import ShareDialog from "../sharing/shareDialog";
import MoveDialog from "../sharing/moveDialog";
import styles from "./dashboard.module.css";

const filters: { value: LibraryFilter; label: string }[] = [
  { value: "ALL", label: "All documents" },
  { value: "FAVORITES", label: "Favorites" },
  { value: "MARKDOWN", label: "Markdown" },
  { value: "LATEX", label: "LaTeX" },
];

const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 440;
const SIDEBAR_WIDTH_KEY = "runes-library-sidebar-width";
const SIDEBAR_RESIZE_EVENT = "runes-library-sidebar-resize";
const clampSidebarWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
let fallbackSidebarWidth = SIDEBAR_DEFAULT_WIDTH;

function storedSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored !== null) {
      const width = Number(stored);
      if (Number.isFinite(width)) return clampSidebarWidth(width);
    }
  } catch {
    // Browser storage may be disabled.
  }
  return fallbackSidebarWidth;
}

function subscribeSidebarWidth(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === SIDEBAR_WIDTH_KEY) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SIDEBAR_RESIZE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SIDEBAR_RESIZE_EVENT, notify);
  };
}

function modifiedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function DashboardPage({ initialCreateFormat = null }: { initialCreateFormat?: CreateFormat | null }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("ALL");
  const [newestFirst, setNewestFirst] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [documentsSectionOpen, setDocumentsSectionOpen] = useState(true);
  const [documentTarget, setDocumentTarget] = useState<WorkspaceTarget | null>(null);
  const sidebarWidth = useSyncExternalStore(subscribeSidebarWidth, storedSidebarWidth, () => SIDEBAR_DEFAULT_WIDTH);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const {
    documents, loading, error, showCreateModal, showErrorModal, errorMessage, isCreating,
    setShowCreateModal, setShowErrorModal, handleCreateDocument, handleDeleteClick, handleFavoriteToggle,
    workspaces, sidebarDocuments, canCreateTeams, selectedWorkspaceId, selectWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, refresh,
  } = useDashboard();
  const [shareTarget, setShareTarget] = useState<{ id: string; label: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated" && initialCreateFormat) setShowCreateModal(true);
  }, [status, initialCreateFormat, setShowCreateModal]);

  const resizeSidebar = (width: number) => {
    const next = clampSidebarWidth(width);
    fallbackSidebarWidth = next;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // Keep the current width for this session.
    }
    window.dispatchEvent(new Event(SIDEBAR_RESIZE_EVENT));
  };

  // The selected workspace gates the list first: the server already scopes the response, and this
  // keeps rows from the previous selection from lingering while the next fetch is in flight.
  const visibleDocuments = useMemo(() => selectLibraryDocuments(documents, {
    workspaceId: selectedWorkspaceId,
    search: searchQuery,
    filter,
    newestFirst,
  }), [documents, selectedWorkspaceId, searchQuery, filter, newestFirst]);

  const selectedDocuments = visibleDocuments.filter((doc) => selectedIds.has(doc.id));
  const allVisibleSelected = visibleDocuments.length > 0 && selectedDocuments.length === visibleDocuments.length;
  const documentCounts: Record<LibraryFilter, number> = {
    ALL: documents.length,
    FAVORITES: documents.filter((doc) => doc.isFavorite).length,
    MARKDOWN: documents.filter((doc) => (doc.format ?? "LATEX") === "MARKDOWN").length,
    LATEX: documents.filter((doc) => (doc.format ?? "LATEX") === "LATEX").length,
  };
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const documentDestination = selectedWorkspace?.canCreate
    ? selectedWorkspace
    : workspaces.find((workspace) => workspace.isDefault && workspace.canCreate);
  const pageTitle = filter === "ALL" ? "All documents" : filter === "FAVORITES" ? "Favorites" : `${filter === "MARKDOWN" ? "Markdown" : "LaTeX"} documents`;
  const scopedPageTitle = selectedWorkspace
    ? filter === "ALL" ? selectedWorkspace.name : `${pageTitle} in ${selectedWorkspace.name}`
    : pageTitle;
  const openCreate = () => { setDocumentTarget(null); setShowCreateModal(true); setSidebarOpen(false); };
  const openCreateInWorkspace = (workspace: WorkspaceTarget) => {
    setDocumentTarget(workspace);
    setShowCreateModal(true);
    setSidebarOpen(false);
  };
  // Every new link is keyed on the document id. Slugs are only unique per workspace, so a slug
  // can open an older twin, and they resolve author-scoped, so a shared recipient cannot use one
  // at all. Slug lookup stays alive server-side purely so links written before this change open.
  const openHrefFor = (doc: DashboardDocument) => documentOpenPath(doc);
  const closeCreate = () => {
    setShowCreateModal(false);
    setDocumentTarget(null);
    if (initialCreateFormat) router.replace(DOCUMENTS_PATH);
  };
  const setLibraryFilter = (next: LibraryFilter) => {
    if (next === "ALL") selectWorkspace(null);
    setFilter(next);
    setSidebarOpen(false);
    setSelectedIds(new Set());
  };
  const selectLibraryWorkspace = (workspaceId: string | null) => {
    selectWorkspace(workspaceId);
    setSelectedIds(new Set());
    setSidebarOpen(false);
  };
  const toggleSelection = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleDocuments.map((doc) => doc.id)));
  const changeFavorites = (favorite: boolean) => {
    for (const doc of selectedDocuments) if (doc.isFavorite !== favorite) void handleFavoriteToggle(doc);
    setSelectedIds(new Set());
  };
  const downloadDocument = (doc: DashboardDocument) => {
    const extension = doc.format === "MARKDOWN" ? "md" : "tex";
    const url = URL.createObjectURL(new Blob([doc.content ?? ""], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.slug}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.shell} data-resizing={resizingSidebar} style={{ "--dashboard-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      {sidebarOpen && <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-foreground/25 md:hidden" />}
      <aside id="document-sidebar" className={styles.sidebar} data-open={sidebarOpen} aria-label="Document navigation">
        <div className="flex h-[49px] shrink-0 items-center justify-between px-4">
          <Link href={DOCUMENTS_PATH} className="text-foreground" aria-label="Runes AI documents"><Logo variant="wordmark" size="sm" /></Link>
          <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="p-1 text-meta md:hidden"><X size={18} /></button>
        </div>
        <div className="shrink-0 px-3 py-2">
          <button type="button" onClick={openCreate} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-surface-raised">
            <Plus size={17} aria-hidden="true" />New document
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-3">
            <WorkspaceSwitcher workspaces={workspaces} documents={sidebarDocuments} selectedId={selectedWorkspaceId}
              onSelect={selectLibraryWorkspace} onOpenDocument={(document) => { setSidebarOpen(false); router.push(DOCUMENT_PATH(document.id)); }}
              onCreate={createWorkspace} onAddDocument={openCreateInWorkspace} onRename={renameWorkspace} onDelete={deleteWorkspace} />
            {canCreateTeams && <Link href="/admin" className="mt-2 flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-action hover:bg-surface-raised">
              <UsersRound className="size-4" aria-hidden="true" />Create and manage teams
            </Link>}
          </div>
          <div className="mx-4 my-5 border-t border-border" />
          <nav className="px-4" aria-label="Library">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-meta">
              <button type="button" aria-label={documentsSectionOpen ? "Collapse documents" : "Expand documents"} aria-expanded={documentsSectionOpen} aria-controls="document-filters"
                onClick={() => setDocumentsSectionOpen((value) => !value)} className="flex min-h-8 w-full items-center gap-1 rounded-md pl-1 text-left hover:text-foreground">
                <ChevronDown className={`size-3.5 shrink-0 transition-transform ${documentsSectionOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
                <Folder size={15} aria-hidden="true" />Documents
              </button>
            </h2>
            <div id="document-filters" hidden={!documentsSectionOpen}>
              {filters.map((item) => (
                <button key={item.value} type="button" onClick={() => setLibraryFilter(item.value)} aria-current={filter === item.value ? "page" : undefined}
                  className={`flex min-h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition-colors hover:bg-surface-raised hover:text-foreground ${filter === item.value ? "bg-action-soft font-medium text-action" : "text-muted-foreground"}`}>
                  <span>{item.label}</span>
                  <span className="min-w-5 text-right font-mono text-xs tabular-nums text-meta">{documentCounts[item.value]}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
        <div className="px-2 pb-4">
          <div className="mx-2 mb-3 border-t border-border" />
          {session?.user?.email && (
            <div className="px-2">
              <UserMenu
                user={{ name: session.user.name || session.user.email.split("@")[0] || "Account", email: session.user.email, avatarSrc: session.user.image || undefined }}
                showName showTheme={false} portal={false} placement="stacked" align="start"
                className="w-full justify-start text-sm"
                onSignOut={() => signOut({ redirectTo: "/" })}
              />
            </div>
          )}
        </div>
        <div className={styles.resizeHandle} role="separator" tabIndex={0} aria-label="Resize document sidebar" aria-controls="document-sidebar" aria-orientation="vertical"
          title="Drag to resize sidebar; double-click to reset"
          aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={sidebarWidth}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizingSidebar(true); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX); }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizingSidebar(false); }}
          onPointerCancel={() => setResizingSidebar(false)}
          onLostPointerCapture={() => setResizingSidebar(false)}
          onDoubleClick={() => resizeSidebar(SIDEBAR_DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 16;
            if (event.key === "ArrowLeft") resizeSidebar(sidebarWidth - step);
            else if (event.key === "ArrowRight") resizeSidebar(sidebarWidth + step);
            else if (event.key === "Home") resizeSidebar(SIDEBAR_MIN_WIDTH);
            else if (event.key === "End") resizeSidebar(SIDEBAR_MAX_WIDTH);
            else return;
            event.preventDefault();
          }} />
      </aside>

      <main className={styles.main}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)} className="text-foreground md:hidden"><Menu size={22} /></button>
            <h1 className="truncate text-[25px] font-semibold leading-8 tracking-tight text-foreground">{scopedPageTitle}</h1>
          </div>
        </div>

        <div className="mb-4">
          <div className="relative w-full max-w-[782px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-meta" aria-hidden="true" />
            <label className="sr-only" htmlFor="document-search">Search in all documents</label>
            <input id="document-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={selectedWorkspace ? `Search in ${selectedWorkspace.name}...` : "Search in all documents..."}
              className="h-10 w-full rounded border border-input bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-meta focus:border-action focus:outline-none focus-visible:ring-2 focus-visible:ring-action/25" />
          </div>
        </div>

        {error && <div role="alert" className="mb-4 flex items-center gap-2 rounded border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive"><TriangleAlert size={16} aria-hidden="true" />{error}</div>}

        {selectedDocuments.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{selectedDocuments.length} selected</span>
            <button type="button" className="font-medium text-action hover:underline" onClick={() => changeFavorites(true)}>Add to favorites</button>
            <button type="button" className="font-medium text-action hover:underline" onClick={() => changeFavorites(false)}>Remove favorites</button>
            <button type="button" className="ml-auto hover:text-foreground" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
          </div>
        )}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>
              <th scope="col"><input type="checkbox" aria-label="Select all shown documents" checked={allVisibleSelected} onChange={toggleAll} disabled={visibleDocuments.length === 0} /></th>
              <th scope="col">Title</th>
              <th scope="col">Owner</th>
              <th scope="col">Workspace</th>
              <th scope="col">Format</th>
              <th scope="col">Access</th>
              <th scope="col"><button type="button" onClick={() => setNewestFirst((value) => !value)} aria-label={`Sort by last modified, ${newestFirst ? "oldest first" : "newest first"}`} className="inline-flex items-center gap-1 hover:text-action">Last modified {newestFirst ? <ArrowDown size={15} aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}</button></th>
            </tr></thead>
            <tbody>
              {status === "loading" || loading ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index}><td /><td><span className="skeleton block h-4 w-44" /></td><td><span className="skeleton block h-4 w-14" /></td><td><span className="skeleton block h-4 w-20" /></td><td><span className="skeleton block h-4 w-16" /></td><td><span className="skeleton block h-4 w-10" /></td><td><span className="skeleton block h-4 w-36" /></td></tr>
              )) : visibleDocuments.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{documents.length === 0 ? selectedWorkspace ? `No documents in ${selectedWorkspace.name} yet. Use the workspace menu to add one.` : "No documents yet. Create one to get started." : "No documents match your search or filter."}</td></tr>
              ) : visibleDocuments.map((doc: DashboardDocument) => (
                <tr key={doc.id}>
                  <td><input type="checkbox" aria-label={`Select ${doc.title}`} checked={selectedIds.has(doc.id)} onChange={() => toggleSelection(doc.id)} /></td>
                  <td><div className="flex min-w-0 items-center gap-1">
                    <button type="button" onClick={() => router.push(documentOpenPath(doc))} className="min-w-0 truncate text-left hover:text-action hover:underline" title={doc.title}>{doc.title}</button>
                    {doc.isFavorite && <Star className="size-3.5 shrink-0 fill-current text-action" aria-label="Favorite" />}
                  </div></td>
                  <td className="truncate" title={documentOwnerLabel(doc)}>{documentOwnerLabel(doc)}</td>
                  <td className="truncate" title={documentWorkspaceLabel(doc)}>{documentWorkspaceLabel(doc)}</td>
                  <td className={styles.formatCell} data-format={doc.format ?? "LATEX"}>{documentFormatLabel(doc)}</td>
                  <td><span className={styles.accessBadge} data-access={documentAccessLabel(doc)}>{documentAccessLabel(doc)}</span></td>
                  <td><div className="flex items-center justify-between gap-3"><time className="whitespace-nowrap" dateTime={doc.updatedAt}>{modifiedAt(doc.updatedAt)}</time><div className={styles.rowActions}><DocumentActions document={doc} canManage={doc.isAuthor !== false} openHref={openHrefFor(doc)} onDelete={() => handleDeleteClick(doc)} onFavoriteChange={() => handleFavoriteToggle(doc)} onDownload={() => downloadDocument(doc)} onShare={doc.isAuthor !== false ? () => setShareTarget({ id: doc.id, label: doc.title }) : undefined} onMove={doc.isAuthor !== false ? () => setMoveTarget({ id: doc.id, label: doc.title }) : undefined} /></div></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-[18px] text-center text-sm text-muted-foreground" role="status">Showing {visibleDocuments.length} out of {documents.length} {documents.length === 1 ? "document" : "documents"}.</p>
      </main>

      <CreateDocumentModal isOpen={showCreateModal} onClose={closeCreate}
        onSubmit={(title, format) => handleCreateDocument(title, format, documentTarget?.id)} isLoading={isCreating}
        existingTitles={documents.filter((doc) => doc.workspaceId === (documentTarget?.id ?? documentDestination?.id)).map((doc) => doc.title)}
        workspaceName={documentTarget?.name ?? documentDestination?.name} initialFormat={initialCreateFormat ?? "MARKDOWN"} />
      <AlertModal isOpen={showErrorModal} onClose={() => setShowErrorModal(false)} title="Error" message={errorMessage} variant="error" />
      {shareTarget && <ShareDialog isOpen onClose={() => setShareTarget(null)} target={{ kind: "DOCUMENT", id: shareTarget.id, label: shareTarget.label }} />}
      {moveTarget && <MoveDialog isOpen onClose={() => setMoveTarget(null)} documentId={moveTarget.id} documentTitle={moveTarget.label} onMoved={refresh} workspaces={workspaces} currentWorkspaceId={selectedWorkspaceId} />}
    </div>
  );
}
