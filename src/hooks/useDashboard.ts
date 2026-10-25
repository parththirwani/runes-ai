import { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { DocumentFormatValue } from '@/src/types/compilation';
import type { WorkspaceSummary } from '@/src/app/components/dashboard/workspaceSwitcher';
import { documentApiUrl, documentsListUrl } from '@/src/lib/dashboard-library';

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
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const response = await fetch('/api/workspaces');
      if (!response.ok) return;
      const data = await response.json();
      setWorkspaces(data.workspaces || []);
    } catch {
      // The switcher simply stays empty; the document list still tells the user what failed.
    }
  }, []);

  const fetchDocuments = useCallback(async (workspaceId: string | null = null) => {
    try {
      setLoading(true);
      setError(null);
      // The selected workspace travels to the server: without it the switcher would only relabel
      // the library while every scope stayed visible.
      const response = await fetch(documentsListUrl(workspaceId));

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
      setWorkspaces(data.workspaces || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const refresh = useCallback(() => fetchDocuments(selectedWorkspaceId), [fetchDocuments, selectedWorkspaceId]);

  const createWorkspace = useCallback(async (name: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error || data.message || 'Could not create the workspace';
      setWorkspaces(await (await fetch('/api/workspaces')).json().then((list) => list.workspaces || []));
      setSelectedWorkspaceId(data.workspace?.id ?? null);
      void fetchDocuments(data.workspace?.id ?? null);
      return null;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : 'Could not create the workspace';
    }
  }, [fetchDocuments]);

  const handleCreateDocument = async (title: string, format: DocumentFormatValue) => {
    setIsCreating(true);
    try {
      // Format is explicit in the request; the server applies the matching
      // tested starting template for the chosen format.
      const response = await fetch('/api/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, format, ...(selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {}) })
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
      // Delete by id: a slug could match a same-slug document in another workspace, and the
      // slug-scoped author lookup would happily resolve and delete the wrong one.
      const response = await fetch(documentApiUrl(doc), {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      setDocuments((current) => current.filter((item) => item.id !== doc.id));
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
      const response = await fetch(`/api/document/${doc.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite }),
      });
      if (!response.ok) throw new Error('Failed to update favorite');
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
    selectedWorkspaceId,
    selectWorkspace,
    createWorkspace,
    refresh,
  };
}
