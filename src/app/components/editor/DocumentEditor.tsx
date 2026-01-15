"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopNavBar from './TopNavBar';
import FileTree from './FileTree';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';
import InputModal from '../ui/InputModal';
import AlertModal from '../ui/AlertModal';

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
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  
  // Modal states
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState('');

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
      setHasUnsavedChanges(true);
    }
  }, [code, title, initialDocument]);

  const handleSave = async (): Promise<boolean> => {
    setIsSaving(true);
    setSaveError(null);

    try {
      if (slug) {
        const response = await fetch(`/api/document/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: code })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to save document');
        }

        setHasUnsavedChanges(false);
        console.log('Document saved successfully');
        return true;
      } else {
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
        
        router.push(`/document/${data.slug}`);
        console.log('Document created successfully');
        return true;
      }
    } catch (error: any) {
      console.error('Save error:', error);
      setSaveError(error.message);
      setErrorModalMessage(error.message);
      setShowErrorModal(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompile = async () => {
    if (!slug) {
      setCompileError('Please save the document first before compiling');
      return;
    }

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

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      
      setPdfUrl(url);
      console.log('Document compiled successfully');
    } catch (error: any) {
      console.error('Compile error:', error);
      setCompileError(error.message);
      setErrorModalMessage(error.message);
      setShowErrorModal(true);
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
    setShowTitleModal(true);
  };

  const handleTitleSubmit = (newTitle: string) => {
    setTitle(newTitle);
    setShowTitleModal(false);
  };

  const handleSettingsToggle = () => {
    setShowSettings(!showSettings);
    // You can implement settings panel here
    console.log('Settings toggled');
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
  }, [title, code, slug]);

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
        onSettingsToggle={handleSettingsToggle}
        onTitleEdit={handleTitleEdit}
        isSaving={isSaving}
        isCompiling={isCompiling}
        hasUnsavedChanges={hasUnsavedChanges}
      />

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

      {/* Modals */}
      <InputModal
        isOpen={showTitleModal}
        onClose={() => setShowTitleModal(false)}
        onSubmit={handleTitleSubmit}
        title="Edit Document Title"
        description="Enter a new title for your document"
        placeholder="e.g., Research Paper, Resume, Report..."
        defaultValue={title}
        submitText="Save"
        maxLength={30}
        validation={(value) => {
          if (value.length < 3) {
            return 'Title must be at least 3 characters';
          }
          return null;
        }}
      />

      <AlertModal
        isOpen={showErrorModal}
        onClose={() => {
          setShowErrorModal(false);
          setSaveError(null);
          setCompileError(null);
        }}
        title="Error"
        message={errorModalMessage}
        variant="error"
      />
    </div>
  );
}