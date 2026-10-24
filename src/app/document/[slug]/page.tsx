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
      <div className="h-screen flex items-center justify-center bg-canvas">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-action border-t-transparent mx-auto mb-4" />
          <p className="text-foreground">Loading document...</p>
          <p className="text-xs text-meta mt-2">Opening {decodedTitle}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-canvas px-5">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface px-6 py-8 text-center shadow-paper">
          <p className="text-destructive mb-2">{error}</p>
          <p className="text-xs text-meta mb-6">Tried to open {decodedTitle}</p>
          <button
            onClick={() => router.push('/document')}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-action px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-action-hover"
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
