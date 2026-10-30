import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { DocumentFormatValue } from '@/src/types/compilation';
import type { SidebarDocument, WorkspaceSummary } from '@/src/app/components/dashboard/workspaceSwitcher';
import { createDocumentsRuntime } from '@/src/lib/dashboard-runtime';

export interface DashboardDocument {
  id: string;
  title: string;
  slug: string;
  content?: string | null;
  format?: DocumentFormatValue;
  isFavorite: boolean;
  excerpt?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceKind?: 'PERSONAL' | 'TEAM';
  authorName?: string;
  isAuthor?: boolean;
  access?: 'Edit' | 'View';
}

export type { WorkspaceSummary } from '@/src/app/components/dashboard/workspaceSwitcher';

export function useDashboard() {
  const router = useRouter();
  const { status } = useSession();
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Library scope. null means "every workspace the caller can read", which is what a visitor
  // who has never touched the switcher expects.
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [sidebarDocuments, setSidebarDocuments] = useState<SidebarDocument[]>([]);
  const [canCreateTeams, setCanCreateTeams] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  // The hook keeps React state; the runtime owns the URLs and the in-flight ordering. Its setters
  // are stable, so a single instance survives re-renders and the stale-response token is shared
  // across every load.
  const runtime = useMemo(() => createDocumentsRuntime<DashboardDocument>({
    setDocuments,
    setWorkspaces: (list) => setWorkspaces(list as WorkspaceSummary[]),
    setLoading,
    setError,
  }), []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const response = await fetch('/api/workspaces');
      if (!response.ok) return;
      const data = await response.json();
      setWorkspaces(data.workspaces || []);
      setSidebarDocuments(data.documents || []);
      setCanCreateTeams(data.canCreateTeams === true);
    } catch {
      // The switcher simply stays empty; the document list still tells the user what failed.
    }
  }, []);

  // The selected workspace travels to the server, and the runtime drops any response that a newer
  // request has already superseded, so switching workspaces fast can never let an earlier scope's
  // rows overwrite the current list.
  const fetchDocuments = useCallback((workspaceId: string | null = null) => runtime.load(workspaceId), [runtime]);

  useEffect(() => {
    if (status === 'authenticated') {
      void fetchDocuments(selectedWorkspaceId);
      void fetchWorkspaces();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const selectWorkspace = useCallback((workspaceId: string | null) => {
    setSelectedWorkspaceId(workspaceId);
    void fetchDocuments(workspaceId);
  }, [fetchDocuments]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchDocuments(selectedWorkspaceId), fetchWorkspaces()]);
  }, [fetchDocuments, fetchWorkspaces, selectedWorkspaceId]);

  const createWorkspace = useCallback(async (name: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error || data.message || 'Could not create the workspace';
      const created = data.workspace;
      if (typeof created?.id !== 'string' || typeof created?.name !== 'string') return 'Could not select the new workspace';
      const summary: WorkspaceSummary = {
        id: created.id, name: created.name, kind: 'PERSONAL', isDefault: false,
        teamId: null, teamName: null, documentCount: 0, access: 'owner',
        canCreate: true, canShare: true, canRename: true, canManageTeam: false,
      };
      setWorkspaces((current) => [...current.filter((workspace) => workspace.id !== summary.id), summary]);
      setSelectedWorkspaceId(summary.id);
      void fetchDocuments(summary.id);
      void fetchWorkspaces();
      return null;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : 'Could not create the workspace';
    }
  }, [fetchDocuments, fetchWorkspaces]);

  const renameWorkspace = useCallback(async (workspaceId: string, name: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error || 'Could not rename the workspace';
      const renamed = data.workspace?.name ?? name.trim();
      setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId ? { ...workspace, name: renamed } : workspace));
      setDocuments((current) => current.map((document) => document.workspaceId === workspaceId ? { ...document, workspaceName: renamed } : document));
      void fetchWorkspaces();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not rename the workspace';
    }
  }, [fetchWorkspaces]);

  const deleteWorkspace = useCallback(async (workspaceId: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error || 'Could not delete the workspace';
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setSidebarDocuments((current) => current.filter((document) => document.workspaceId !== workspaceId));
      if (selectedWorkspaceId === workspaceId) {
        setSelectedWorkspaceId(null);
        void fetchDocuments(null);
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not delete the workspace';
    }
  }, [fetchDocuments, selectedWorkspaceId]);

  const handleCreateDocument = async (title: string, format: DocumentFormatValue, workspaceId?: string) => {
    setIsCreating(true);
    try {
      // Creating from a readable-only scope goes to the user's default personal workspace.
      const writableWorkspaceId = workspaceId ?? workspaces.find((workspace) => workspace.id === selectedWorkspaceId && workspace.canCreate)?.id;
      // Format is explicit in the request; the server applies the matching
      // tested starting template for the chosen format.
      const response = await fetch('/api/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, format, ...(writableWorkspaceId ? { workspaceId: writableWorkspaceId } : {}) })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to create document');
      }

      const newDoc = await response.json();
      setShowCreateModal(false);
      // New links open by document id: slugs are only unique per workspace, so a slug link can
      // land on an older twin, and recipients cannot resolve slugs at all.
      router.push(`/document/${newDoc.id ?? newDoc.slug}`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create document');
      setShowCreateModal(false);
      setShowErrorModal(true);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteClick = async (doc: DashboardDocument) => {
    try {
      // Delete by id via the runtime: a slug could match a same-slug document in another workspace,
      // and the slug-scoped author lookup would happily resolve and delete the wrong one.
      await runtime.remove(doc);
      setDocuments((current) => current.filter((item) => item.id !== doc.id));
      setSidebarDocuments((current) => current.filter((item) => item.id !== doc.id));
      void fetchWorkspaces();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('Failed to delete document');
      setErrorMessage(error.message);
      setShowErrorModal(true);
      throw error;
    }
  };

  const handleFavoriteToggle = async (doc: DashboardDocument) => {
    const isFavorite = !doc.isFavorite;
    setDocuments((current) => current.map((item) => item.id === doc.id ? { ...item, isFavorite } : item));
    try {
      // Toggle by id via the runtime, exactly like delete: the slug fallback let a same-slug twin in
      // another workspace be favorited instead of the row the user actually clicked.
      await runtime.setFavorite(doc, isFavorite);
    } catch (err: unknown) {
      setDocuments((current) => current.map((item) => item.id === doc.id ? { ...item, isFavorite: doc.isFavorite } : item));
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update favorite');
      setShowErrorModal(true);
    }
  };

  return {
    documents,
    loading,
    error,
    showCreateModal,
    showErrorModal,
    errorMessage,
    isCreating,
    setShowCreateModal,
    setShowErrorModal,
    handleCreateDocument,
    handleDeleteClick,
    handleFavoriteToggle,
    workspaces,
    sidebarDocuments,
    canCreateTeams,
    selectedWorkspaceId,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    refresh,
  };
}
