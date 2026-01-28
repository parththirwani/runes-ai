"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useDashboard } from '@/src/hooks/useDashboard';
import AlertModal from '../design/AlertModal';
import ConfirmModal from '../design/ConfirmModal';
import InputModal from '../design/InputModal';
import DashboardHeader from './dashboardHeader';
import DashboardSearch from './dashboardSearch';
import DocumentGrid from './documentGrid';
import DocumentList from './documentList';
import EmptyState from './emptyState';


export default function DashboardPage() {
  const router = useRouter();
  const { status } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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

  const filteredDocuments = documents.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

        <div className="mb-8">
          <DashboardSearch
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
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

      <InputModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateDocument}
        title="Create New Document"
        description="Enter a name for your LaTeX document"
        placeholder="e.g., Research Paper, Resume, Report..."
        submitText="Create"
        isLoading={isCreating}
        maxLength={30}
        validation={(value) => {
          if (value.length < 3) {
            return 'Title must be at least 3 characters';
          }
          if (documents.some(doc => doc.title.toLowerCase() === value.toLowerCase())) {
            return 'A document with this name already exists';
          }
          return null;
        }}
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