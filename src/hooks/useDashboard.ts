import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { DocumentFormatValue } from '@/src/types/compilation';

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
}

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

  useEffect(() => {
    if (status === 'authenticated') {
      fetchDocuments();
    }
  }, [status]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/document');
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDocument = async (title: string, format: DocumentFormatValue) => {
    setIsCreating(true);
    try {
      // Format is explicit in the request; the server applies the matching
      // tested starting template for the chosen format.
      const response = await fetch('/api/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, format })
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
        throw new Error('Failed to delete document');
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
    handleCreateDocument,
    handleDeleteClick,
    handleFavoriteToggle,
  };
}
