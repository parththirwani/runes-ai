"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useDashboard } from '@/src/hooks/useDashboard';
import AlertModal from '../design/AlertModal';
import ConfirmModal from '../design/ConfirmModal';
import DashboardHeader from './dashboardHeader';
import DashboardToolbar from './dashboardToolbar';
import DocumentGrid from './documentGrid';
import DocumentList from './documentList';
import EmptyState from './emptyState';
import CreateDocumentModal from './createDocumentModal';
import FormatFilter, { type FormatFilterValue } from './formatFilter';
import { DOCUMENTS_PATH, type CreateFormat } from '@/src/lib/paths';


export default function DashboardPage({ initialCreateFormat = null }: { initialCreateFormat?: CreateFormat | null }) {
  const router = useRouter();
  const { status } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [formatFilter, setFormatFilter] = useState<FormatFilterValue>('ALL');

  const {
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
  } = useDashboard();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/signin');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated' && initialCreateFormat) {
      setShowCreateModal(true);
    }
  }, [status, initialCreateFormat, setShowCreateModal]);

  const closeCreateModal = () => {
    setShowCreateModal(false);
    if (initialCreateFormat) router.replace(DOCUMENTS_PATH);
  };

  const titleMatches = documents.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredDocuments = titleMatches.filter(doc => {
    if (formatFilter === 'ALL') return true;
    // Legacy rows always have a format after migration; LATEX is the safe
    // fallback if an old cached payload lacks the field.
    return (doc.format ?? 'LATEX') === formatFilter;
  });
  const formatCounts = useMemo(() => ({
    ALL: titleMatches.length,
    MARKDOWN: titleMatches.filter((doc) => (doc.format ?? 'LATEX') === 'MARKDOWN').length,
    LATEX: titleMatches.filter((doc) => (doc.format ?? 'LATEX') === 'LATEX').length,
  }), [titleMatches]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#1e1e1e] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-emerald-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-white">
      <DashboardHeader onCreateDocument={() => setShowCreateModal(true)} />

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="mb-12">
          <h2 className="text-3xl font-semibold mb-2 tracking-tight">Documents</h2>
          <p className="text-gray-500 text-sm">
            {documents.length} {documents.length === 1 ? 'document' : 'documents'}
          </p>
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-60">
            <DashboardToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              resultCount={filteredDocuments.length}
              totalCount={documents.length}
            />
          </div>
          <FormatFilter value={formatFilter} onChange={setFormatFilter} counts={formatCounts} />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-8 text-sm">
            {error}
          </div>
        )}

        {filteredDocuments.length === 0 ? (
          <EmptyState
            searchQuery={searchQuery}
            onCreateDocument={() => setShowCreateModal(true)}
            filtered={documents.length > 0}
          />
        ) : viewMode === 'grid' ? (
          <DocumentGrid
            documents={filteredDocuments}
            onDocumentClick={(slug) => router.push(`/document/${slug}`)}
            onDocumentDelete={handleDeleteClick}
          />
        ) : (
          <DocumentList
            documents={filteredDocuments}
            onDocumentClick={(slug) => router.push(`/document/${slug}`)}
            onDocumentDelete={handleDeleteClick}
          />
        )}
      </main>

      <CreateDocumentModal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        onSubmit={handleCreateDocument}
        isLoading={isCreating}
        existingTitles={documents.map((doc) => doc.title)}
        initialFormat={initialCreateFormat ?? 'MARKDOWN'}
      />

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Document"
        message={`Are you sure you want to delete "${documentToDelete?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />

      <AlertModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="Error"
        message={errorMessage}
        variant="error"
      />
    </div>
  );
}
