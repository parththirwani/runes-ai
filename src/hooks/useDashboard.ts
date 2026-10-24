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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<DashboardDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleDeleteClick = (doc: DashboardDocument) => {
    setDocumentToDelete(doc);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/document/${documentToDelete.slug}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      setDocuments(documents.filter(doc => doc.slug !== documentToDelete.slug));
      setShowDeleteModal(false);
      setDocumentToDelete(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete document');
      setShowDeleteModal(false);
      setShowErrorModal(true);
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    documents,
    loading,
    error,
    showCreateModal,
    showDeleteModal,
    showErrorModal,
    documentToDelete,
    errorMessage,
    isCreating,
    isDeleting,
    setShowCreateModal,
    setShowDeleteModal,
    setShowErrorModal,
    handleCreateDocument,
    handleDeleteClick,
    handleDeleteConfirm
  };
}
