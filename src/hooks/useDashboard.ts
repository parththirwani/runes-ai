import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { LibraryDocument, LibraryScope } from '@/src/types/library';
import type { DocumentFormatValue } from '@/src/types/compilation';

export type DashboardDocument = LibraryDocument;

/**
 * The document half of the library, for one scope at a time. Capability flags arrive with each
 * row, so the interface can show View or Edit without asking a second question; the server still
 * re-checks every action.
 */
export function useDashboard(scope: LibraryScope) {
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

  // Scope in primitives: the fetch callback then depends on one stable string instead of an
  // object the caller rebuilds on every render.
  const scopeKind = scope.kind;
  const scopeWorkspaceId = scope.kind === 'workspace' ? scope.id : null;
  const fetchUrl = useMemo(() => {
    if (scopeKind === 'workspace' && scopeWorkspaceId) return "/api/workspaces/" + scopeWorkspaceId + "/documents";
    return scopeKind === 'shared' ? '/api/document?scope=shared' : '/api/document';
  }, [scopeKind, scopeWorkspaceId]);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      // A workspace scope lists that collection; "shared with me" and "all" go to the library
      // endpoint, which answers from the same capability query the document routes use.
      const response = await fetch(fetchUrl);

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  }, [fetchUrl]);

  useEffect(() => {
    if (status === 'authenticated') {
      void fetchDocuments();
    }
  }, [status, fetchDocuments]);

  const handleCreateDocument = async (title: string, format: DocumentFormatValue, workspaceId?: string) => {
    setIsCreating(true);
    try {
      // Format is explicit in the request and the server applies the matching tested template.
      // A named workspace is checked against the capability service there, not here.
      const response = await fetch('/api/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, format, workspaceId })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to create document');
      }

      const newDoc = await response.json();
      setShowCreateModal(false);
      router.push(`/document/${newDoc.slug}`);
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
      const response = await fetch(`/api/document/${doc.slug}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error((error as { message?: string } | null)?.message || 'Failed to delete document');
      }

      setDocuments((current) => current.filter((item) => item.slug !== doc.slug));
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
    fetchDocuments,
    handleCreateDocument,
    handleDeleteClick,
    handleFavoriteToggle,
  };
}
