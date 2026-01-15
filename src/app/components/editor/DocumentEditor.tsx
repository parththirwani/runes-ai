"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopNavBar from './TopNavBar';
import FileTree from './FileTree';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';

type ViewMode = 'editor' | 'split' | 'preview';

const initialCode = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{My LaTeX Document}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
This is the introduction section of your document.

\\section{Main Content}
Add your main content here. You can use various LaTeX commands to format your text.

\\subsection{A Subsection}
This is a subsection with some mathematical notation: $E = mc^2$

\\begin{equation}
    \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\\end{equation}

\\section{Conclusion}
Summarize your findings here.

\\end{document}`;

interface DocumentEditorProps {
  initialDocument?: {
    id: string;
    title: string;
    content: string;
    slug: string;
  } | null;
}

export default function DocumentEditor({ initialDocument }: DocumentEditorProps) {
  const router = useRouter();
  const [code, setCode] = useState(initialDocument?.content || initialCode);
  const [title, setTitle] = useState(initialDocument?.title || 'Untitled Document');
  const [slug, setSlug] = useState(initialDocument?.slug || '');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    if (initialDocument) {
      setCode(initialDocument.content);
      setTitle(initialDocument.title);
      setSlug(initialDocument.slug);
    }
  }, [initialDocument]);

  useEffect(() => {
    if (initialDocument) {
      const hasChanged = 
        code !== initialDocument.content || 
        title !== initialDocument.title;
      setHasUnsavedChanges(hasChanged);
    } else if (code !== initialCode || title !== 'Untitled Document') {
      // New document that hasn't been saved yet
      setHasUnsavedChanges(true);
    }
  }, [code, title, initialDocument]);

  const handleSave = async (): Promise<boolean> => {
    setIsSaving(true);
    setSaveError(null);

    try {
      if (slug) {
        // Update existing document
        const response = await fetch(`/api/document/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: code })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to save document');
        }

        const data = await response.json();
        setHasUnsavedChanges(false);
        console.log('Document saved successfully');
        return true;
      } else {
        // Create new document
        const response = await fetch('/api/document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: code })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create document');
        }

        const data = await response.json();
        setSlug(data.slug);
        setHasUnsavedChanges(false);
        
        // Update URL without reload
        router.replace(`/document?slug=${data.slug}`);
        console.log('Document created successfully');
        return true;
      }
    } catch (error: any) {
      console.error('Save error:', error);
      setSaveError(error.message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompile = async () => {
    // Check if document needs to be saved first
    if (!slug) {
      setCompileError('Please save the document first before compiling');
      return;
    }

    // Auto-save if there are unsaved changes
    if (hasUnsavedChanges) {
      setCompileError('Saving changes before compiling...');
      const saveSuccess = await handleSave();
      if (!saveSuccess) {
        setCompileError('Failed to save document. Please try saving manually.');
        return;
      }
      setCompileError(null);
    }

    setIsCompiling(true);
    setCompileError(null);

    try {
      const response = await fetch(`/api/document/${slug}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Compilation failed');
      }

      // Get PDF as blob
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      // Revoke previous URL if exists
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      
      setPdfUrl(url);
      console.log('Document compiled successfully');
    } catch (error: any) {
      console.error('Compile error:', error);
      setCompileError(error.message);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleDownload = async () => {
    if (!pdfUrl) {
      alert('Please compile the document first');
      return;
    }

    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `${slug || 'document'}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleTitleEdit = () => {
    const newTitle = prompt('Enter document title:', title);
    if (newTitle && newTitle.trim()) {
      setTitle(newTitle.trim());
    }
  };

  // Auto-save every 30 seconds if there are unsaved changes
  useEffect(() => {
    if (hasUnsavedChanges && slug) {
      const autoSaveTimer = setTimeout(() => {
        handleSave();
      }, 30000);

      return () => clearTimeout(autoSaveTimer);
    }
  }, [hasUnsavedChanges, slug]);

  // Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [title, code, slug]); // Include dependencies so handleSave has latest values

  // Cleanup PDF URL on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] overflow-hidden">
      <TopNavBar
        documentTitle={title}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onMenuToggle={() => setShowFileTree(!showFileTree)}
        onSave={handleSave}
        onCompile={handleCompile}
        onAIToggle={() => setShowAI(!showAI)}
        onTitleEdit={handleTitleEdit}
        isSaving={isSaving}
        isCompiling={isCompiling}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {saveError && (
        <div className="bg-red-500 text-white px-4 py-2 text-sm">
          Error saving: {saveError}
          <button 
            onClick={() => setSaveError(null)}
            className="ml-4 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {compileError && (
        <div className="bg-red-500 text-white px-4 py-2 text-sm">
          Compilation error: {compileError}
          <button 
            onClick={() => setCompileError(null)}
            className="ml-4 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        <FileTree
          isOpen={showFileTree}
          onClose={() => setShowFileTree(false)}
          onNewFile={() => router.push('/document')}
        />

        <div className="h-full flex">
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} border-r border-[#3e3e3e]`}>
              <MonacoEditorWrapper
                value={code}
                onChange={setCode}
                fileName={`${slug || 'untitled'}.tex`}
              />
            </div>
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <PDFPreview
                pdfUrl={pdfUrl}
                isLoading={isCompiling}
                onCompile={handleCompile}
                onDownload={handleDownload}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}