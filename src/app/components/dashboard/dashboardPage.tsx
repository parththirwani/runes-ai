"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useDashboard } from "@/src/hooks/useDashboard";
import { signInPath } from "@/src/lib/paths";
import AlertModal from "../design/AlertModal";
import ConfirmModal from "../design/ConfirmModal";
import InputModal from "../design/InputModal";
import { Button } from "../ui/button";
import DashboardHeader from "./dashboardHeader";
import DashboardToolbar from "./dashboardToolbar";
import DocumentGrid from "./documentGrid";
import DocumentList from "./documentList";
import DocumentSkeleton from "./documentSkeleton";
import EmptyState from "./emptyState";

export default function DashboardPage() {
  const router = useRouter();
  const { status } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

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
    fetchDocuments,
    handleCreateDocument,
    handleDeleteClick,
    handleDeleteConfirm
  } = useDashboard();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInPath());
    }
  }, [status, router]);

  const query = searchQuery.trim().toLowerCase();
  const filteredDocuments = query
    ? documents.filter((doc) => doc.title.toLowerCase().includes(query))
    : documents;

  const heading = (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <h1 className="text-2xl font-semibold text-foreground">Documents</h1>
      <p className="text-sm text-meta">Most recently updated first</p>
    </div>
  );

  const body = () => {
    if (status === "loading" || loading) {
      return (
        <>
          <p className="sr-only" role="status">Loading documents</p>
          <DocumentSkeleton viewMode={viewMode} />
        </>
      );
    }

    if (error) {
      return (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive-subtle p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
            {error}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your documents are still saved. This is only the list failing to load, so
            it is usually worth another try.
          </p>
          <Button variant="secondary" size="sm" className="mt-5" onClick={() => void fetchDocuments()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      );
    }

    if (documents.length === 0) {
      return <EmptyState onCreateDocument={() => setShowCreateModal(true)} />;
    }

    if (filteredDocuments.length === 0) {
      return (
        <EmptyState
          searchQuery={searchQuery}
          onClearSearch={() => setSearchQuery("")}
        />
      );
    }

    return viewMode === "grid" ? (
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
    );
  };

  return (
    <div className="min-h-dvh bg-canvas text-foreground">
      <DashboardHeader onCreateDocument={() => setShowCreateModal(true)} />

      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-10 lg:px-8 lg:py-12">
        {heading}

        <div className="mt-8 mb-6">
          <DashboardToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            resultCount={filteredDocuments.length}
            totalCount={documents.length}
          />
        </div>

        {body()}
      </main>

      <InputModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateDocument}
        label="Document title"
        title="Create new document"
        description="Names are unique across your workspace and become the file title."
        placeholder="e.g. Research paper, Lab report, Thesis chapter"
        submitText="Create document"
        isLoading={isCreating}
        maxLength={30}
        validation={(value) => {
          if (value.length < 3) {
            return "Title must be at least 3 characters";
          }
          if (documents.some((doc) => doc.title.toLowerCase() === value.toLowerCase())) {
            return "A document with this name already exists";
          }
          return null;
        }}
      />

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete document"
        message={`“${documentToDelete?.title}” and its compiled PDF will be removed. This cannot be undone.`}
        confirmText="Delete document"
        cancelText="Keep document"
        variant="danger"
        isLoading={isDeleting}
      />

      <AlertModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="Something went wrong"
        message={errorMessage}
        variant="error"
      />
    </div>
  );
}
