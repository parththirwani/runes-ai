"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, Folder, Menu, Plus, Search, Star, TriangleAlert, X } from "lucide-react";
import { useDashboard, type DashboardDocument } from "@/src/hooks/useDashboard";
import { DOCUMENTS_PATH, type CreateFormat } from "@/src/lib/paths";
import UserMenu from "@/components/arc/user-menu/user-menu";
import AlertModal from "../design/AlertModal";
import Logo from "../brand/logo";
import CreateDocumentModal from "./createDocumentModal";
import DocumentActions from "./documentActions";
import WorkspaceSwitcher from "./workspaceSwitcher";
import ShareDialog from "../sharing/shareDialog";
import MoveDialog from "../sharing/moveDialog";
import styles from "./dashboard.module.css";

type LibraryFilter = "ALL" | "FAVORITES" | "MARKDOWN" | "LATEX";

const filters: { value: LibraryFilter; label: string }[] = [
  { value: "ALL", label: "All documents" },
  { value: "FAVORITES", label: "Favorites" },
  { value: "MARKDOWN", label: "Markdown" },
  { value: "LATEX", label: "LaTeX" },
];

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const {
    documents, loading, error, showCreateModal, showErrorModal, errorMessage, isCreating,
    setShowCreateModal, setShowErrorModal, handleCreateDocument, handleDeleteClick, handleFavoriteToggle,
    workspaces, selectedWorkspaceId, selectWorkspace, createWorkspace, refresh,
  } = useDashboard();
  const [shareTarget, setShareTarget] = useState<{ id: string; label: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated" && initialCreateFormat) setShowCreateModal(true);
  }, [status, initialCreateFormat, setShowCreateModal]);

  const visibleDocuments = useMemo(() => documents
    .filter((doc) => doc.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .filter((doc) => filter === "ALL" || (filter === "FAVORITES" ? doc.isFavorite : (doc.format ?? "LATEX") === filter))
    .sort((a, b) => (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) * (newestFirst ? 1 : -1)),
  [documents, searchQuery, filter, newestFirst]);

  const selectedDocuments = visibleDocuments.filter((doc) => selectedIds.has(doc.id));
  const allVisibleSelected = visibleDocuments.length > 0 && selectedDocuments.length === visibleDocuments.length;
  const documentCounts: Record<LibraryFilter, number> = {
    ALL: documents.length,
    FAVORITES: documents.filter((doc) => doc.isFavorite).length,
    MARKDOWN: documents.filter((doc) => (doc.format ?? "LATEX") === "MARKDOWN").length,
    LATEX: documents.filter((doc) => (doc.format ?? "LATEX") === "LATEX").length,
  };
  const pageTitle = filter === "ALL" ? "All documents" : filter === "FAVORITES" ? "Favorites" : `${filter === "MARKDOWN" ? "Markdown" : "LaTeX"} documents`;
  const openCreate = () => setShowCreateModal(true);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  // Authors keep the readable URL; a recipient only ever has the document id, and slugs are
  // resolved author-scoped on purpose, so the id is the only link that works for them.
  const openHrefFor = (doc: DashboardDocument) => (doc.isAuthor === false ? `/document/${doc.id}` : `/document/${doc.slug}`);
  const closeCreate = () => {
    setShowCreateModal(false);
    if (initialCreateFormat) router.replace(DOCUMENTS_PATH);
  };
  const setLibraryFilter = (next: LibraryFilter) => {
    setFilter(next);
    setSidebarOpen(false);
    setSelectedIds(new Set());
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
    <div className={styles.shell}>
      {sidebarOpen && <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-foreground/25 md:hidden" />}
      <aside className={styles.sidebar} data-open={sidebarOpen} aria-label="Document navigation">
        <div className="flex h-[49px] shrink-0 items-center justify-between px-4">
          <Link href={DOCUMENTS_PATH} className="text-foreground" aria-label="Runes AI documents"><Logo variant="wordmark" size="sm" /></Link>
          <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="p-1 text-meta md:hidden"><X size={18} /></button>
        </div>
        <nav className="px-2" aria-label="Library">
          <button type="button" className={styles.navItem} data-active="true" onClick={() => setLibraryFilter("ALL")}>
            <Folder size={17} aria-hidden="true" /><span>Documents</span>
          </button>
          <div className="mt-1 pl-8">
            {filters.map((item) => (
              <button key={item.value} type="button" onClick={() => setLibraryFilter(item.value)} aria-current={filter === item.value ? "page" : undefined}
                className={`flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left text-[15px] transition-colors hover:bg-surface-raised hover:text-foreground ${filter === item.value ? "font-medium text-action" : "text-muted-foreground"}`}>
                <span>{item.label}</span>
                <span className="min-w-5 text-right font-mono text-xs tabular-nums text-meta">{documentCounts[item.value]}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="mx-4 mt-3 border-t border-border" />
        <div className="px-4 pt-6">
          <p className="mb-3 pl-3 text-xs font-semibold uppercase tracking-wide text-meta">Workspace</p>
          <button type="button" onClick={openCreate} className={`${styles.navItem} gap-2`}><Plus size={17} aria-hidden="true" /> New document</button>
        </div>
        <div className="mt-auto px-2 pb-4">
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
      </aside>

      <main className={styles.main}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)} className="text-foreground md:hidden"><Menu size={22} /></button>
            <h1 className="truncate text-[25px] font-semibold leading-8 tracking-tight text-foreground">{pageTitle}</h1>
          </div>
        </div>

        <div className="mb-4">
          <div className="relative w-full max-w-[782px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-meta" aria-hidden="true" />
            <label className="sr-only" htmlFor="document-search">Search in all documents</label>
            <input id="document-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search in all documents..."
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
              <th scope="col"><button type="button" onClick={() => setNewestFirst((value) => !value)} aria-label={`Sort by last modified, ${newestFirst ? "oldest first" : "newest first"}`} className="inline-flex items-center gap-1 hover:text-action">Last modified {newestFirst ? <ArrowDown size={15} aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}</button></th>
            </tr></thead>
            <tbody>
              {status === "loading" || loading ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index}><td /><td><span className="skeleton block h-4 w-44" /></td><td><span className="skeleton block h-4 w-14" /></td><td><span className="skeleton block h-4 w-36" /></td></tr>
              )) : visibleDocuments.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">{documents.length === 0 ? "No documents yet. Create one to get started." : "No documents match your search or filter."}</td></tr>
              ) : visibleDocuments.map((doc: DashboardDocument) => (
                <tr key={doc.id}>
                  <td><input type="checkbox" aria-label={`Select ${doc.title}`} checked={selectedIds.has(doc.id)} onChange={() => toggleSelection(doc.id)} /></td>
                  <td><div className="flex min-w-0 items-center gap-1">
                    <button type="button" onClick={() => router.push(`/document/${doc.slug}`)} className="min-w-0 truncate text-left hover:text-action hover:underline" title={doc.title}>{doc.title}</button>
                    {doc.isFavorite && <Star className="size-3.5 shrink-0 fill-current text-action" aria-label="Favorite" />}
                  </div></td>
                  <td>You</td>
                  <td><div className="flex items-center justify-between gap-3"><time className="whitespace-nowrap" dateTime={doc.updatedAt}>{modifiedAt(doc.updatedAt)}</time><div className={styles.rowActions}><DocumentActions document={doc} canManage={doc.isAuthor !== false} openHref={openHrefFor(doc)} onDelete={() => handleDeleteClick(doc)} onFavoriteChange={() => handleFavoriteToggle(doc)} onDownload={() => downloadDocument(doc)} onShare={doc.isAuthor !== false ? () => setShareTarget({ id: doc.id, label: doc.title }) : undefined} onMove={doc.isAuthor !== false ? () => setMoveTarget({ id: doc.id, label: doc.title }) : undefined} /></div></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-[18px] text-center text-sm text-muted-foreground" role="status">Showing {visibleDocuments.length} out of {documents.length} {documents.length === 1 ? "document" : "documents"}.</p>
      </main>

      <CreateDocumentModal isOpen={showCreateModal} onClose={closeCreate} onSubmit={handleCreateDocument} isLoading={isCreating} existingTitles={documents.map((doc) => doc.title)} initialFormat={initialCreateFormat ?? "MARKDOWN"} />
      <AlertModal isOpen={showErrorModal} onClose={() => setShowErrorModal(false)} title="Error" message={errorMessage} variant="error" />
      {shareTarget && <ShareDialog isOpen onClose={() => setShareTarget(null)} target={{ kind: "DOCUMENT", id: shareTarget.id, label: shareTarget.label }} />}
      {moveTarget && <MoveDialog isOpen onClose={() => setMoveTarget(null)} documentId={moveTarget.id} documentTitle={moveTarget.label} onMoved={refresh} workspaces={workspaces} currentWorkspaceId={selectedWorkspaceId} />}
    </div>
  );
}
