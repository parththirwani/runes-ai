"use client";

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DocumentEditor from '../components/editor/DocumentEditor';
import { useSession } from 'next-auth/react';

function DocumentContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug');
  
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/signin');
      return;
    }

    if (status === 'authenticated' && slug) {
      fetchDocument();
    } else if (status === 'authenticated' && !slug) {
      setLoading(false);
    }
  }, [status, slug]);

  const fetchDocument = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/document/${slug}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('Document not found');
        } else {
          setError('Failed to load document');
        }
        return;
      }

      const data = await response.json();
      setDocument(data.document);
    } catch (err) {
      console.error('Error fetching document:', err);
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <DocumentEditor initialDocument={document} />;
}

export default function DocumentPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" />
      </div>
    }>
      <DocumentContent />
    </Suspense>
  );
}