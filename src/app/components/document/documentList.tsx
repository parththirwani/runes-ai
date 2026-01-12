"use client";

import { Document } from "./documentPage";
import DocumentCard from "./documentCard";

type DocumentListProps = {
  documents: Document[];
  isLoading: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updatedDoc: Document) => void;
};

export default function DocumentList({
  documents,
  isLoading,
  onRefresh,
  onDelete,
  onUpdate,
}: DocumentListProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-sm text-gray-600">Loading documents...</p>
        </div>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <div className="text-center py-12">
          <svg
            className="mx-auto h-16 w-16 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No documents yet
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Get started by creating your first document using the form on the left.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-lg shadow-sm p-4 border border-gray-200">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Your Documents
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {documents.length} {documents.length === 1 ? "document" : "documents"} total
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      <div className="grid gap-4">
        {documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}