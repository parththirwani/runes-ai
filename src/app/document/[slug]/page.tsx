// src/app/document/[slug]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DocumentEditor from '../../components/editor/DocumentEditor';
import { workspaceClient } from '@/src/lib/workspace-client';
import type { WorkspaceDocumentPayload } from '@/src/lib/workspace-types';

export default function DocumentPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const decodedTitle = useMemo(() => slug?.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Document', [slug]);
  
  const [document, setDocument] = useState<WorkspaceDocumentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocument = useCallback(async (signal: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      setDocument(null);
      try {
        const loaded = await workspaceClient.load(slug);
        if (!signal.aborted) setDocument(loaded);
      } catch (loadError) {
        const status = (loadError as { status?: number }).status;
        if (!signal.aborted) setError(status === 404 ? 'Document not found' : 'Failed to load document');
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error('Error fetching document:', err);
        setError('Failed to load document');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/signin');
      return;
    }

    if (status === 'authenticated' && slug) {
      const controller = new AbortController();
      void fetchDocument(controller.signal);
      return () => controller.abort();
    }
  }, [status, slug, router, fetchDocument]);

  if (status === 'loading' || loading || (!document && !error)) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading document...</p>
          <p className="text-xs text-gray-600 mt-2">Opening {decodedTitle}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <p className="text-xs text-gray-500 mb-6">Tried to open {decodedTitle}</p>
          <button
            onClick={() => router.push('/document')}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            Go to Documents
          </button>
        </div>
      </div>
    );
  }

  if (!document) return null;
  return <DocumentEditor key={document.id} initialDocument={document} />;
}
