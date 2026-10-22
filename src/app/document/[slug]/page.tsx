// src/app/document/[slug]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import DocumentEditor from '../../components/editor/DocumentEditor';
import Button from '../../components/design/Button';

export default function DocumentPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const decodedTitle = useMemo(() => slug?.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Document', [slug]);
  
  const [document, setDocument] = useState<{ id: string; title: string; content: string; slug: string; format?: 'LATEX' | 'MARKDOWN' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocument = useCallback(async (signal: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      setDocument(null);
      const response = await fetch(`/api/document/${slug}`, { signal });
      if (!response.ok) {
        setError(response.status === 404 ? 'Document not found' : 'Failed to load document');
        return;
      }
      const data = await response.json();
      if (!signal.aborted) setDocument(data.document);
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
      <main id="main" role="status" className="flex h-screen items-center justify-center bg-canvas text-center">
        <div>
          <LoaderCircle className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Loading document...</p>
          <p className="mt-2 font-mono text-xs text-meta">Opening {decodedTitle}</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main id="main" role="alert" className="flex h-screen items-center justify-center bg-canvas text-center">
        <div>
          <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-base font-medium text-foreground">{error}</p>
          <p className="mt-2 mb-6 font-mono text-xs text-meta">Tried to open {decodedTitle}</p>
          <Button onClick={() => router.push('/document')}>Go to Documents</Button>
        </div>
      </main>
    );
  }

  if (!document) return null;
  return <DocumentEditor key={document.id} initialDocument={document} />;
}
