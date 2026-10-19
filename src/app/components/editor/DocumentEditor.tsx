"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopNavBar from './TopNavBar';
import FileTree from './FileTree';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';
import DiffReview from './DiffReview';
import InputModal from '../design/InputModal';
import AlertModal from '../design/AlertModal';
import Button from '../design/Button';
import { JobStatus } from '@/src/types/compilation';
import { EditProposal, verifyAcceptance, generateProposalId } from '@/src/lib/proposal-engine';
import { analyzeSelection, scanContext } from '@/src/lib/latex-utils';
import type { editor } from 'monaco-editor';
import { Wand2, RefreshCw } from 'lucide-react';

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
  const [compileError, setCompileError] = useState<string | null>(null);

  // Document ID for proposals
  const documentId = initialDocument?.id || 'new';

  // Job polling
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [compilationStatus, setCompilationStatus] = useState('');

  // Modal states
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState('');

  // Editor instance ref
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  // AI state
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true);
  const autocompleteEnabledRef = useRef(true);
  const [paraphraseDisabledReason, setParaphraseDisabledReason] = useState<string | null>(null);

  // Sync state → refs for closure-safe reads inside the Monaco provider
  useEffect(() => { autocompleteEnabledRef.current = autocompleteEnabled; }, [autocompleteEnabled]);
  const proposalRef = useRef<EditProposal | null>(null);
  useEffect(() => { proposalRef.current = proposal; }, [proposal]);

  // Autocomplete: debounce timer, abort controller, request ID, and provider disposable
  const completeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeAbortRef = useRef<AbortController | null>(null);
  const completeRequestIdRef = useRef(0);
  const completeProviderDisposableRef = useRef<{ dispose(): void } | null>(null);

  // Staleness tracking for paraphrase
  const pendingParaphraseStaleRef = useRef(false);

  // Proposal verification
  const [stalenessReason, setStalenessReason] = useState<string | null>(null);
  const lastModelVersionRef = useRef(-1);

  // Track PDF staleness
  const [pdfIsStale, setPdfIsStale] = useState(false);

  // Store the most recent tone used for paraphrase
  const lastToneRef = useRef('Clearer');

  // --- Init from initialDocument ---
  useEffect(() => {
    if (initialDocument) {
      setCode(initialDocument.content);
      setTitle(initialDocument.title);
      setSlug(initialDocument.slug);
    }
  }, [initialDocument]);

  // --- Dirty tracking ---
  useEffect(() => {
    if (initialDocument) {
      const hasChanged = code !== initialDocument.content || title !== initialDocument.title;
      setHasUnsavedChanges(hasChanged);
      if (hasChanged && pdfUrl) setPdfIsStale(true);
    } else if (code !== initialCode || title !== 'Untitled Document') {
      setHasUnsavedChanges(true);
    }
  }, [code, title, initialDocument, pdfUrl]);

  // --- Key handlers ---
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

  // --- Autosave ---
  useEffect(() => {
    if (hasUnsavedChanges && slug) {
      const timer = setTimeout(() => { handleSave(); }, 30000);
      return () => clearTimeout(timer);
    }
  }, [hasUnsavedChanges, slug]);

  // --- Job polling ---
  useEffect(() => {
    if (!currentJobId) return;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/job/${currentJobId}`);
        if (!response.ok) {
          clearInterval(pollInterval);
          setIsCompiling(false);
          setCompileError('Job status check failed');
          setCurrentJobId(null);
          return;
        }
        const status = await response.json();
        switch (status.status) {
          case JobStatus.PENDING:
            setCompilationStatus('Queued...');
            break;
          case JobStatus.PROCESSING:
            setCompilationStatus('Compiling...');
            break;
          case JobStatus.COMPLETED:
            clearInterval(pollInterval);
            setCompilationStatus('');
            setIsCompiling(false);
            await downloadPDF(currentJobId);
            setCurrentJobId(null);
            break;
          case JobStatus.FAILED:
            clearInterval(pollInterval);
            setCompilationStatus('');
            setIsCompiling(false);
            const errMsg = status.result?.error || 'Compilation failed';
            setCompileError(errMsg);
            setErrorModalMessage(errMsg);
            setShowErrorModal(true);
            setCurrentJobId(null);
            break;
        }
      } catch {
        clearInterval(pollInterval);
        setIsCompiling(false);
        setCurrentJobId(null);
      }
    }, 2000);
    return () => clearInterval(pollInterval);
  }, [currentJobId]);

  // --- Editor ready callback — register inline completion provider once Monaco is ready ---
  const handleEditorReady = useCallback((editorInstance: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;

    // Dispose any previous provider (e.g. after re-mount)
    if (completeProviderDisposableRef.current) {
      completeProviderDisposableRef.current.dispose();
      completeProviderDisposableRef.current = null;
    }

    // Resolver for the previous debounce promise, so we can resolve it when
    // a newer keystroke arrives before the debounce fires.
    let pendingDebounceResolver: ((v: { items: [] }) => void) | null = null;

    const provider = monaco.languages.registerInlineCompletionsProvider('latex', {
      provideInlineCompletions: async (model, position) => {
        // Read live state from refs (the provider closure is created once at mount)
        if (!autocompleteEnabledRef.current || proposalRef.current) return { items: [] };

        const offset = model.getOffsetAt(position);
        const fullSource = model.getValue();
        const ctx = scanContext(fullSource, offset);
        if (!ctx.isInDocument || ctx.isInPreamble || ctx.isInMath || ctx.isInVerbatim || ctx.isInComment || ctx.isInCommandName || ctx.isInCommandArg) {
          return { items: [] };
        }

        const sel = editorInstance.getSelection();
        if (sel && !sel.isEmpty()) return { items: [] };

        const prefix = fullSource.slice(Math.max(0, offset - 2000), offset);
        const suffix = fullSource.slice(offset, offset + 1000);

        // Cancel existing debounce and resolve its promise so Monaco doesn't
        // hold a dangling unresolved promise.
        if (completeDebounceRef.current) {
          clearTimeout(completeDebounceRef.current);
          if (pendingDebounceResolver) {
            pendingDebounceResolver({ items: [] });
            pendingDebounceResolver = null;
          }
        }

        return new Promise((resolve) => {
          pendingDebounceResolver = resolve as (v: { items: [] }) => void;

          completeDebounceRef.current = setTimeout(async () => {
            pendingDebounceResolver = null;

            if (completeAbortRef.current) completeAbortRef.current.abort();

            const requestId = ++completeRequestIdRef.current;
            const abortCtrl = new AbortController();
            completeAbortRef.current = abortCtrl;
            const modelVersion = model.getVersionId();

            try {
              const res = await fetch('/api/ai/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  documentId,
                  prefix: prefix.slice(-2000),
                  suffix: suffix.slice(0, 1000),
                  requestId: String(requestId),
                }),
                signal: abortCtrl.signal,
              });

              if (!res.ok || requestId !== completeRequestIdRef.current) { resolve({ items: [] }); return; }

              const data = await res.json();
              if (!data.insertion || requestId !== completeRequestIdRef.current) { resolve({ items: [] }); return; }

              const curPos = editorInstance.getPosition();
              if (model.getVersionId() !== modelVersion ||
                  curPos?.lineNumber !== position.lineNumber ||
                  curPos?.column !== position.column ||
                  proposalRef.current) {
                resolve({ items: [] }); return;
              }

              const insertion = data.insertion;
              if (!insertion || insertion.length > 200) { resolve({ items: [] }); return; }

              resolve({
                items: [{ insertText: insertion, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column } }],
              });
            } catch { resolve({ items: [] }); }
          }, 400);
        });
      },
      disposeInlineCompletions: () => {},
    });

    completeProviderDisposableRef.current = provider;
  }, [documentId]);

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      if (completeProviderDisposableRef.current) {
        completeProviderDisposableRef.current.dispose();
        completeProviderDisposableRef.current = null;
      }
    };
  }, []);

  // --- Paraphrase action ---
  const handleParaphrase = useCallback(async (tone: string = 'Clearer') => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    lastToneRef.current = tone;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      setParaphraseDisabledReason('No text selected');
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const startOffset = model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn });
    const endOffset = model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn });
    const selectedText = model.getValue().slice(startOffset, endOffset);

    // Context analysis
    const ctx = scanContext(model.getValue(), startOffset);
    const analysis = analyzeSelection(selectedText, ctx);
    if (!analysis.eligible) {
      setParaphraseDisabledReason(analysis.reason || 'Selection not eligible for paraphrase');
      return;
    }

    // Capture context
    const fullText = model.getValue();
    const before = fullText.slice(Math.max(0, startOffset - 1000), startOffset);
    const after = fullText.slice(endOffset, endOffset + 1000);
    const modelVersion = model.getVersionId();
    lastModelVersionRef.current = modelVersion;

    setIsAiLoading(true);
    setAiError(null);
    setParaphraseDisabledReason(null);
    pendingParaphraseStaleRef.current = false;

    // Listen for content changes between request and response
    const modelForListener = model;
    const contentChangeListener = modelForListener.onDidChangeContent(() => {
      pendingParaphraseStaleRef.current = true;
    });

    try {
      const res = await fetch('/api/ai/paraphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          selectedText: analysis.maskedSelection || selectedText,
          before,
          after,
          tone,
          requestId: generateProposalId(),
        }),
      });

      contentChangeListener.dispose();

      // If user edited while we were waiting, discard
      if (pendingParaphraseStaleRef.current) {
        setAiError('Response discarded — document was edited while AI was working');
        setIsAiLoading(false);
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setAiError('Rate limit reached. Please wait before trying again.');
        } else {
          setAiError(data.error || 'Failed to get AI suggestion');
        }
        setIsAiLoading(false);
        return;
      }

      if (data.noop || !data.replacementText) {
        setAiError('No change suggested');
        setIsAiLoading(false);
        return;
      }

      let replacementText = data.replacementText;

      // If we used masking, restore protected tokens
      if (analysis.protectedTokens.length > 0) {
        const { verifyAndRestore } = await import('@/src/lib/latex-utils');
        const result = verifyAndRestore(analysis.maskedSelection, replacementText, analysis.protectedTokens);
        if (!result.success) {
          setAiError(result.reason);
          setIsAiLoading(false);
          return;
        }
        replacementText = result.restored;
      }

      const prop: EditProposal = {
        id: generateProposalId(),
        documentId,
        source: 'paraphrase',
        baseModelVersion: modelVersion,
        range: { startOffset, endOffset },
        originalText: selectedText,
        replacementText,
        state: 'pending',
      };

      setProposal(prop);
      setStalenessReason(null);
      setIsAiLoading(false);
    } catch (err: unknown) {
      contentChangeListener.dispose();
      if (err instanceof Error && err.name !== 'AbortError') {
        setAiError('Network error. Please try again.');
      }
      setIsAiLoading(false);
    }
  }, [documentId]);

  // --- Accept proposal ---
  const handleAccept = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !proposal) return;

    const model = editor.getModel();
    if (!model) return;

    // Verify acceptance — check state and original text match
    const fullText = model.getValue();
    const verification = verifyAcceptance(proposal, fullText);

    if (!verification.applied) {
      setStalenessReason(verification.reason || 'Cannot accept');
      setProposal({ ...proposal, state: 'stale' });
      return;
    }

    // Verify the original text is still at the position
    const actualText = fullText.slice(proposal.range.startOffset, proposal.range.endOffset);
    if (actualText !== proposal.originalText) {
      setStalenessReason('Selection text has been modified');
      setProposal({ ...proposal, state: 'stale' });
      return;
    }

    // Apply the edit using Monaco's executeEdits for undo support
    const startPos = model.getPositionAt(proposal.range.startOffset);
    const endPos = model.getPositionAt(proposal.range.endOffset);

    editor.pushUndoStop();
    editor.executeEdits('ai-proposal', [
      {
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
        text: proposal.replacementText,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();

    // Update code state to match
    const newCode = model.getValue();
    setCode(newCode);

    // Clear the proposal
    setProposal(null);
    setStalenessReason(null);
    setHasUnsavedChanges(true);
    setPdfIsStale(true);
  }, [proposal]);

  // --- Reject proposal ---
  const handleReject = useCallback(() => {
    setProposal(null);
    setStalenessReason(null);
    setAiError(null);
    // Source unchanged — zero bytes changed
  }, []);

  // --- Regenerate ---
  const handleRegenerate = useCallback(() => {
    setProposal(null);
    setStalenessReason(null);
    setAiError(null);
    // Re-paraphrase with the same tone that was used last time
    handleParaphrase(lastToneRef.current);
  }, [handleParaphrase]);

  // --- PDF download ---
  const downloadPDF = async (jobId: string) => {
    try {
      const response = await fetch(`/api/pdf/${jobId}`);
      if (!response.ok) throw new Error('Failed to download PDF');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(url);
      setPdfIsStale(false);
    } catch (error: unknown) {
      console.error('PDF download error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCompileError(message);
      setErrorModalMessage(message);
      setShowErrorModal(true);
    }
  };

  // --- Save ---
  const handleSave = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);

    try {
      if (slug) {
        const response = await fetch(`/api/document/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: code }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to save document');
        }
        setHasUnsavedChanges(false);
        return true;
      } else {
        const response = await fetch('/api/document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: code }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create document');
        }
        const data = await response.json();
        setSlug(data.slug);
        setHasUnsavedChanges(false);
        router.push(`/document/${data.slug}`);
        return true;
      }
    } catch (error: unknown) {
      console.error('Save error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setErrorModalMessage(message);
      setShowErrorModal(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [slug, title, code, router]);

  // --- Compile ---
  const handleCompile = async () => {
    if (!slug) {
      setCompileError('Please save the document first before compiling');
      return;
    }

    // Reject proposals silently — only accepted text compiles
    if (proposal) {
      setProposal(null);
      setStalenessReason(null);
    }

    if (hasUnsavedChanges) {
      setCompilationStatus('Saving changes...');
      const saveSuccess = await handleSave();
      if (!saveSuccess) {
        setCompileError('Failed to save document. Please try saving manually.');
        return;
      }
      setCompileError(null);
    }

    setIsCompiling(true);
    setCompileError(null);
    setCompilationStatus('Queueing compilation...');

    try {
      const response = await fetch(`/api/document/${slug}`, { method: 'POST' });

      if (response.status === 429) {
        const error = await response.json();
        const resetAt = new Date(error.resetAt);
        const seconds = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
        setCompileError(`${error.message} Please wait ${seconds}s.`);
        setErrorModalMessage(compileError || 'Rate limit reached');
        setShowErrorModal(true);
        setIsCompiling(false);
        return;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Failed to queue compilation');
      }

      const data = await response.json();
      setCurrentJobId(data.jobId);
      setCompilationStatus('Queued...');
    } catch (error: unknown) {
      console.error('Compile error:', error);
      setIsCompiling(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCompileError(message);
      setErrorModalMessage(message);
      setShowErrorModal(true);
    }
  };

  // --- Download handler ---
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

  // --- Title edit ---
  const handleTitleSubmit = (newTitle: string) => {
    setTitle(newTitle);
    setShowTitleModal(false);
  };

  // --- Code change from editor ---
  const handleCodeChange = useCallback((newValue: string) => {
    setCode(newValue);
    // If there's a pending proposal, check staleness
    if (proposal) {
      const model = editorRef.current?.getModel();
      if (model) {
        const version = model.getVersionId();
        if (version !== proposal.baseModelVersion) {
          setStalenessReason('Document was edited while proposal was pending');
          setProposal(prev => prev ? { ...prev, state: 'stale' } : null);
        }
      }
    }
    // If a paraphrase is pending (isAiLoading but no proposal yet), mark it stale
    if (isAiLoading) {
      pendingParaphraseStaleRef.current = true;
    }
  }, [proposal, isAiLoading]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      if (completeAbortRef.current) completeAbortRef.current.abort();
      if (completeDebounceRef.current) clearTimeout(completeDebounceRef.current);
      if (completeProviderDisposableRef.current) {
        completeProviderDisposableRef.current.dispose();
        completeProviderDisposableRef.current = null;
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
        onSettingsToggle={() => setShowSettings(!showSettings)}
        onTitleEdit={() => setShowTitleModal(true)}
        isSaving={isSaving}
        isCompiling={isCompiling}
        hasUnsavedChanges={hasUnsavedChanges}
        compilationStatus={compilationStatus}
      />

      <div className="flex-1 relative overflow-hidden">
        <FileTree
          isOpen={showFileTree}
          onClose={() => setShowFileTree(false)}
          onNewFile={() => router.push('/document')}
        />

        <div className="h-full flex">
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} border-r border-[#3e3e3e] flex flex-col`}>
              {/* AI Toolbar */}
              <div className="h-10 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center px-3 gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleParaphrase('Clearer')}
                  disabled={isAiLoading}
                  icon={<Wand2 className="w-3.5 h-3.5" />}
                  title={paraphraseDisabledReason || 'Paraphrase selection (Clearer)'}
                >
                  Paraphrase
                </Button>

                <div className="h-4 w-px bg-[#3e3e3e]" />

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500">Tone:</span>
                  {['Clearer', 'Shorter', 'Formal'].map((t) => (
                    <button
                      key={t}
                      onClick={() => handleParaphrase(t)}
                      disabled={isAiLoading}
                      className="text-[11px] px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-[#3e3e3e] transition-colors disabled:opacity-40"
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  {isAiLoading && (
                    <span className="text-xs text-blue-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      AI working...
                    </span>
                  )}
                  {aiError && !proposal && (
                    <span className="text-xs text-yellow-400">{aiError}</span>
                  )}

                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autocompleteEnabled}
                      onChange={(e) => setAutocompleteEnabled(e.target.checked)}
                      className="w-3 h-3 accent-emerald-500"
                    />
                    AI complete
                  </label>
                </div>
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-hidden">
                <MonacoEditorWrapper
                  value={code}
                  onChange={handleCodeChange}
                  fileName={`${slug || 'untitled'}.tex`}
                  onEditorReady={handleEditorReady}
                />
              </div>

              {/* Diff review panel */}
              {proposal && (
                <div className="border-t border-[#3e3e3e] shrink-0">
                  <DiffReview
                    proposal={proposal}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    onRegenerate={handleRegenerate}
                    stalenessReason={stalenessReason || undefined}
                  />
                </div>
              )}

              {/* PDF stale indicator */}
              {pdfIsStale && pdfUrl && (
                <div className="h-7 bg-yellow-900/30 border-t border-yellow-700/50 flex items-center px-3 text-[11px] text-yellow-400 shrink-0">
                  <span>PDF is older than the current source — recompile to update</span>
                </div>
              )}
            </div>
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <PDFPreview
                pdfUrl={pdfUrl}
                isLoading={isCompiling}
                onCompile={handleCompile}
                onDownload={handleDownload}
                statusMessage={compilationStatus}
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
        validation={(value: string) => value.length < 3 ? 'Title must be at least 3 characters' : null}
      />

      <AlertModal
        isOpen={showErrorModal}
        onClose={() => {
          setShowErrorModal(false);
          setCompileError(null);
        }}
        title="Error"
        message={errorModalMessage}
        variant="error"
      />
    </div>
  );
}