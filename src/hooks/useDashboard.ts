import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { DashboardDocument } from "@/src/types/dashboard";
import { DOCUMENTS_PATH, signInPath } from "@/src/lib/paths";

export function useDashboard() {
  const router = useRouter();
  const { status } = useSession();
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<DashboardDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/document");
      if (!response.ok) {
        if (response.status === 401) {
          router.push(signInPath(DOCUMENTS_PATH));
          return;
        }
        throw new Error("We could not load your documents.");
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not load your documents.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (status === "authenticated") {
      void fetchDocuments();
    }
  }, [status, fetchDocuments]);

  const handleCreateDocument = async (title: string) => {
    setIsCreating(true);
    try {
      const response = await fetch("/api/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Start writing your document here.

\\end{document}`
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "We could not create that document.");
      }

      const newDoc = await response.json();
      setShowCreateModal(false);
      router.push(`/document/${newDoc.slug}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "We could not create that document.");
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
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(`“${documentToDelete.title}” is still in your workspace. Try again in a moment.`);
      }

      setDocuments((current) => current.filter((doc) => doc.slug !== documentToDelete.slug));
      setShowDeleteModal(false);
      setDocumentToDelete(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "The delete did not go through.");
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
    fetchDocuments,
    handleCreateDocument,
    handleDeleteClick,
    handleDeleteConfirm
  };
}
