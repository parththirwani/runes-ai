"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TriangleAlert } from 'lucide-react';
import { useDashboard } from '@/src/hooks/useDashboard';
import AlertModal from '../design/AlertModal';
import ConfirmModal from '../design/ConfirmModal';
import DashboardHeader from './dashboardHeader';
import DashboardToolbar from './dashboardToolbar';
import DocumentGrid from './documentGrid';
import DocumentList from './documentList';
import DocumentSkeleton from './documentSkeleton';
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
      <div className="min-h-screen bg-canvas">
        <DashboardHeader onCreateDocument={() => setShowCreateModal(true)} />
        <main className="mx-auto w-full max-w-content px-6 py-12 lg:px-8">
          <div className="mb-10">
            <h1 className="font-serif text-[28px] font-semibold tracking-tight text-foreground md:text-[32px] md:leading-[38px]">
              Documents
            </h1>
            <span className="skeleton mt-3 block h-3 w-28" />
          </div>
          <DocumentSkeleton viewMode={viewMode} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <DashboardHeader onCreateDocument={() => setShowCreateModal(true)} />

      <main className="mx-auto w-full max-w-content px-6 py-12 lg:px-8">
        <div className="mb-10">
          <h1 className="font-serif text-[28px] font-semibold tracking-tight text-foreground md:text-[32px] md:leading-[38px]">
            Documents
          </h1>
          <p className="mt-2 text-sm text-meta">
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
          <div
            role="alert"
            className="mb-8 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {filteredDocuments.length === 0 ? (
          <EmptyState
            searchQuery={searchQuery}
            onCreateDocument={() => setShowCreateModal(true)}
            onClearFilters={() => {
              setSearchQuery('');
              setFormatFilter('ALL');
            }}
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
