"use client";

import { useState, useEffect } from "react";
import DocumentForm from "./documentForm";
import DocumentList from "./documentList";

export type Document = {
  id: string;
  title: string;
  content: string;
  userId: string;
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">My Documents</h1>
          <p className="mt-2 text-gray-600">
            Create and manage your documents
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <DocumentForm onDocumentCreated={handleDocumentCreated} />
          </div>

          <div className="lg:col-span-2">
            <DocumentList
              documents={documents}
              isLoading={isLoading}
              onRefresh={fetchDocuments}
            />
          </div>
        </div>
      </div>
    </div>
  );
}