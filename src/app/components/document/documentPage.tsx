"use client";

import { useState, useEffect } from "react";
import DocumentForm from "./documentForm";
import DocumentList from "./documentList";
import QuickStartGuide from "./quickStart";


export type Document = {
  id: string;
  title: string;
  content: string;
  userId: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/document");
      const data = await response.json();
      
      if (response.ok) {
        setDocuments(data.documents);
      } else {
        console.error("Failed to fetch documents:", data.message);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDocumentCreated = (newDocument: Document) => {
    setDocuments((prev) => [newDocument, ...prev]);
  };

  const handleDocumentDeleted = (deletedId: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== deletedId));
  };

  const handleDocumentUpdated = (updatedId: string, updatedDoc: Document) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === updatedId ? updatedDoc : doc))
    );
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 bg-blue-600 rounded-xl shadow-lg">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">My Documents</h1>
              <p className="mt-1 text-gray-600">
                Create, manage, and organize your documents
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form Section */}
          <div className="lg:col-span-1">
            <DocumentForm onDocumentCreated={handleDocumentCreated} />
          </div>

          {/* Document List Section */}
          <div className="lg:col-span-2">
            <DocumentList
              documents={documents}
              isLoading={isLoading}
              onRefresh={fetchDocuments}
              onDelete={handleDocumentDeleted}
              onUpdate={handleDocumentUpdated}
            />
          </div>
        </div>
      </div>

      {/* Quick Start Guide */}
      <QuickStartGuide />
    </div>
  );
}