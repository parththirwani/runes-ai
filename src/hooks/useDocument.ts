import { useState, useCallback } from 'react';

interface Document {
  id: string;
  title: string;
  content: string;
  slug: string;
}

interface UseDocumentReturn {
  loading: boolean;
  error: string | null;
  saveDocument: (title: string, content: string, slug?: string) => Promise<Document | null>;
  compileDocument: (slug: string) => Promise<Blob | null>;
  fetchDocument: (slug: string) => Promise<Document | null>;
  deleteDocument: (slug: string) => Promise<boolean>;
}

export function useDocument(): UseDocumentReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDocument = useCallback(async (
    title: string,
    content: string,
    slug?: string
  ): Promise<Document | null> => {
    setLoading(true);
    setError(null);

    try {
      let response;
      
      if (slug) {
        // Update existing document
        response = await fetch(`/api/document/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content })
        });
      } else {
        // Create new document
        response = await fetch('/api/document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content })
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save document');
      }

      const data = await response.json();
      return slug ? data.document : data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const compileDocument = useCallback(async (slug: string): Promise<Blob | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/document/${slug}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Compilation failed');
      }

      return await response.blob();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDocument = useCallback(async (slug: string): Promise<Document | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/document/${slug}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch document');
      }

      const data = await response.json();
      return data.document;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteDocument = useCallback(async (slug: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/document/${slug}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete document');
      }

      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    saveDocument,
    compileDocument,
    fetchDocument,
    deleteDocument
  };
}