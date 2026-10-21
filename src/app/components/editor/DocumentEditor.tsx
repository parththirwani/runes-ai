"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopNavBar from './TopNavBar';
import FileTree from './FileTree';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';
import DiffReview from './DiffReview';
import AiWorkspacePanel from './AiWorkspacePanel';
import InputModal from '../design/InputModal';
import AlertModal from '../design/AlertModal';
import Button from '../design/Button';
import { JobStatus } from '@/src/types/compilation';
import type { DocumentFormatValue } from '@/src/types/compilation';
import { EditProposal, verifyAcceptance, checkStale, generateProposalId } from '@/src/lib/proposal-engine';
import { analyzeSelection, scanContext, selectionCutsWord } from '@/src/lib/latex-utils';
import { analyzeMarkdownSelection, markdownLineIsProse, scanMarkdownContext } from '@/src/lib/markdown-utils';
import { buildLatexOutline } from '@/src/lib/latex-outline';
import { buildMarkdownOutline } from '@/src/lib/markdown-outline';
import MarkdownPreviewPane from './MarkdownPreviewPane';
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
    format?: DocumentFormatValue;
  } | null;
}

export default function DocumentEditor({ initialDocument }: DocumentEditorProps) {
  const router = useRouter();
  // Format is fixed at creation and read from the stored document row.
  const format: DocumentFormatValue = initialDocument?.format ?? 'LATEX';
  const isMarkdown = format === 'MARKDOWN';
  const extension = isMarkdown ? 'md' : 'tex';
  const language = isMarkdown ? 'markdown' : 'latex';
  const [code, setCode] = useState(initialDocument?.content ?? initialCode);
  const [title, setTitle] = useState(initialDocument?.title || 'Untitled Document');
  const [slug, setSlug] = useState(initialDocument?.slug || '');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const pdfUrlRef = useRef<string | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const savedSnapshotRef = useRef({ content: initialDocument?.content ?? initialCode, title: initialDocument?.title ?? 'Untitled Document' });
  const latestRef = useRef({ content: code, title });
  latestRef.current = { content: code, title };
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const downloadPdfRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  const [compileError, setCompileError] = useState<string | null>(null);

  // Document ID for proposals
  const documentId = initialDocument?.id || 'new';

  // Job polling
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [compilationStatus, setCompilationStatus] = useState('');
  const [currentLineNumber, setCurrentLineNumber] = useState(1);

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
  const [autocompleteNotice, setAutocompleteNotice] = useState<string | null>(null);
  const autocompleteNoticeShownRef = useRef(false);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true);
  const autocompleteEnabledRef = useRef(true);
  const [paraphraseDisabledReason, setParaphraseDisabledReason] = useState<string | null>('Select prose to paraphrase');
  const selectionListenerRef = useRef<{ dispose(): void } | null>(null);
  const cursorListenerRef = useRef<{ dispose(): void } | null>(null);

  // Sync state → refs for closure-safe reads inside the Monaco provider
  useEffect(() => { autocompleteEnabledRef.current = autocompleteEnabled; }, [autocompleteEnabled]);
  const proposalRef = useRef<EditProposal | null>(null);
  useEffect(() => { proposalRef.current = proposal; }, [proposal]);

  // Autocomplete: debounce timer, abort controller, request ID, and provider disposable
  const completeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeDebounceResolverRef = useRef<((v: { items: [] }) => void) | null>(null);
  const completeAbortRef = useRef<AbortController | null>(null);
  const completeRequestIdRef = useRef(0);
  const completeProviderDisposableRef = useRef<{ dispose(): void } | null>(null);

  // Staleness tracking for paraphrase
  const pendingParaphraseStaleRef = useRef(false);
  const paraphraseAbortRef = useRef<AbortController | null>(null);
  const paraphraseRequestIdRef = useRef(0);

  // Proposal verification
  const [stalenessReason, setStalenessReason] = useState<string | null>(null);

  // Track PDF staleness
  const [pdfIsStale, setPdfIsStale] = useState(false);
  const compileSourceRef = useRef<string | null>(null);

  // Store the most recent tone used for paraphrase
  const lastToneRef = useRef('Clearer');
  const fileName = `${slug || 'untitled'}.${extension}`;
  const modelUri = `runes://${documentId}/${fileName}`;
  const outline = isMarkdown
    ? buildMarkdownOutline(code, fileName, currentLineNumber)
    : buildLatexOutline(code, fileName, currentLineNumber);

  // --- Dirty tracking ---
  useEffect(() => {
    const hasChanged = code !== savedSnapshotRef.current.content || title !== savedSnapshotRef.current.title;
    setHasUnsavedChanges(hasChanged);
    if (code !== savedSnapshotRef.current.content && pdfUrl) setPdfIsStale(true);
  }, [code, title, pdfUrl]);

  // --- Key handlers ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Autosave ---
  useEffect(() => {
    if (hasUnsavedChanges && slug) {
      const timer = setTimeout(() => { saveRef.current(); }, 30000);
      return () => clearTimeout(timer);
    }
  }, [hasUnsavedChanges, slug, code, title]);

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
            await downloadPdfRef.current(currentJobId);
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
    selectionListenerRef.current?.dispose();
    cursorListenerRef.current?.dispose();
    selectionListenerRef.current = editorInstance.onDidChangeCursorSelection(() => {
      const model = editorInstance.getModel();
      const selection = editorInstance.getSelection();
      if (!model || !selection || selection.isEmpty()) {
        setParaphraseDisabledReason('Select prose to paraphrase');
        return;
      }
      const full = model.getValue();
      const start = model.getOffsetAt(selection.getStartPosition());
      const end = model.getOffsetAt(selection.getEndPosition());
      const selected = full.slice(start, end);
      const analysis = isMarkdown
        ? analyzeMarkdownSelection(selected, scanMarkdownContext(full, start))
        : analyzeSelection(selected, scanContext(full, start));
      setParaphraseDisabledReason(
        !analysis.eligible ? analysis.reason || 'Unsupported selection' :
        selectionCutsWord(full.slice(0, start), selected, full.slice(end)) ? 'Select complete words' : null,
      );
    });
    cursorListenerRef.current = editorInstance.onDidChangeCursorPosition((event) => {
      setCurrentLineNumber(event.position.lineNumber);
    });

    // Dispose any previous provider (e.g. after re-mount)
    if (completeProviderDisposableRef.current) {
      completeProviderDisposableRef.current.dispose();
      completeProviderDisposableRef.current = null;
    }

    const provider = monaco.languages.registerInlineCompletionsProvider(language, {
      provideInlineCompletions: async (model, position, _context, token) => {
        // Read live state from refs (the provider closure is created once at mount)
        if (!autocompleteEnabledRef.current || proposalRef.current || token.isCancellationRequested || model !== editorInstance.getModel()) return { items: [] };

        const requestId = ++completeRequestIdRef.current;
        completeAbortRef.current?.abort();

        const offset = model.getOffsetAt(position);
        const fullSource = model.getValue();
        if (isMarkdown) {
          // Suppress completions in front matter, code, math, link/image
          // destinations, raw HTML, tables, headings, and list markers.
          const mdCtx = scanMarkdownContext(fullSource, offset);
          const lineUpToCursor = fullSource.slice(0, offset).slice(fullSource.slice(0, offset).lastIndexOf('\n') + 1);
          if (mdCtx.inProtected || !markdownLineIsProse(lineUpToCursor)) {
            return { items: [] };
          }
        } else {
          const ctx = scanContext(fullSource, offset);
          if (!ctx.isInDocument || ctx.isInPreamble || ctx.isInMath || ctx.isInVerbatim || ctx.isInComment || ctx.isInCommandName || ctx.isInCommandArg) {
            return { items: [] };
          }
        }

        const sel = editorInstance.getSelection();
        if (sel && !sel.isEmpty()) return { items: [] };

        const prefix = fullSource.slice(Math.max(0, offset - 2000), offset);
        const suffix = fullSource.slice(offset, offset + 1000);

        // Cancel existing debounce and resolve its promise so Monaco doesn't
        // hold a dangling unresolved promise.
        if (completeDebounceRef.current) {
          clearTimeout(completeDebounceRef.current);
          if (completeDebounceResolverRef.current) {
            completeDebounceResolverRef.current({ items: [] });
            completeDebounceResolverRef.current = null;
          }
        }

        return new Promise((resolve) => {
          completeDebounceResolverRef.current = resolve as (v: { items: [] }) => void;

          completeDebounceRef.current = setTimeout(async () => {
            completeDebounceResolverRef.current = null;
            completeDebounceRef.current = null;

            if (token.isCancellationRequested || requestId !== completeRequestIdRef.current) {
              resolve({ items: [] });
              return;
            }

            if (completeAbortRef.current) completeAbortRef.current.abort();

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

              if (!res.ok || token.isCancellationRequested || requestId !== completeRequestIdRef.current) {
                if (!token.isCancellationRequested && requestId === completeRequestIdRef.current &&
                    (res.status === 429 || res.status >= 500) && !autocompleteNoticeShownRef.current) {
                  autocompleteNoticeShownRef.current = true;
                  setAutocompleteNotice(res.status === 429 ? 'AI completion rate limit reached' : 'AI completion unavailable');
                }
                resolve({ items: [] }); return;
              }

              const data = await res.json();
              if (!data.insertion || token.isCancellationRequested || requestId !== completeRequestIdRef.current) { resolve({ items: [] }); return; }

              const curPos = editorInstance.getPosition();
              if (model.getVersionId() !== modelVersion ||
                  curPos?.lineNumber !== position.lineNumber ||
                  curPos?.column !== position.column ||
                  proposalRef.current || !autocompleteEnabledRef.current || editorInstance.getModel() !== model) {
                resolve({ items: [] }); return;
              }

              const insertion = data.insertion;
              if (!insertion || insertion.length > 200) { resolve({ items: [] }); return; }

              resolve({
                items: [{ insertText: insertion, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column } }],
              });
            } catch (error: unknown) {
              if (!(error instanceof Error && error.name === 'AbortError') && !autocompleteNoticeShownRef.current) {
                autocompleteNoticeShownRef.current = true;
                setAutocompleteNotice('AI completion unavailable');
              }
              resolve({ items: [] });
            }
          }, 400);
        });
      },
      disposeInlineCompletions: () => {},
    });

    completeProviderDisposableRef.current = provider;
  }, [documentId]);

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

    // Context analysis (format-specific rules)
    const analysis = isMarkdown
      ? analyzeMarkdownSelection(selectedText, scanMarkdownContext(model.getValue(), startOffset))
      : analyzeSelection(selectedText, scanContext(model.getValue(), startOffset));
    if (!analysis.eligible || selectionCutsWord(model.getValue().slice(0, startOffset), selectedText, model.getValue().slice(endOffset))) {
      setParaphraseDisabledReason(analysis.reason || 'Select complete words');
      return;
    }

    // Capture context
    const fullText = model.getValue();
    const before = fullText.slice(Math.max(0, startOffset - 1000), startOffset);
    const after = fullText.slice(endOffset, endOffset + 1000);
    const modelVersion = model.getVersionId();

    paraphraseAbortRef.current?.abort();
    const requestId = ++paraphraseRequestIdRef.current;
    const controller = new AbortController();
    paraphraseAbortRef.current = controller;
    setProposal(null);

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
          selectedText,
          before,
          after,
          tone,
          requestId: String(requestId),
        }),
        signal: controller.signal,
      });

      contentChangeListener.dispose();

      // If user edited while we were waiting, discard
      if (requestId !== paraphraseRequestIdRef.current ||
          pendingParaphraseStaleRef.current ||
          editor.getModel() !== model || model.getVersionId() !== modelVersion) {
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

      const replacementText = data.replacementText;
      if (typeof replacementText !== 'string' || replacementText.length > 12_000) {
        setAiError('Invalid AI response');
        setIsAiLoading(false);
        return;
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
      if (requestId !== paraphraseRequestIdRef.current) return;
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

    const stale = checkStale(
      proposal, documentId, model.getVersionId(),
      model.getValue().slice(proposal.range.startOffset, proposal.range.endOffset),
    );
    if (stale.isStale) {
      setStalenessReason(stale.reason || 'Proposal is stale');
      setProposal({ ...proposal, state: 'stale' });
      return;
    }

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
  }, [proposal, documentId]);

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
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = url;
      setPdfUrl(url);
      setPdfIsStale(latestRef.current.content !== compileSourceRef.current);
    } catch (error: unknown) {
      console.error('PDF download error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCompileError(message);
      setErrorModalMessage(message);
      setShowErrorModal(true);
    }
  };
  downloadPdfRef.current = downloadPDF;

  // --- Save ---
  const handleSave = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    const { content: contentToSave, title: titleToSave } = latestRef.current;

    try {
      if (slug) {
        const response = await fetch(`/api/document/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleToSave, content: contentToSave }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to save document');
        }
        savedSnapshotRef.current = { content: contentToSave, title: titleToSave };
        setHasUnsavedChanges(latestRef.current.content !== contentToSave || latestRef.current.title !== titleToSave);
        return true;
      } else {
        const response = await fetch('/api/document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleToSave, content: contentToSave }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create document');
        }
        const data = await response.json();
        setSlug(data.slug);
        savedSnapshotRef.current = { content: contentToSave, title: titleToSave };
        setHasUnsavedChanges(latestRef.current.content !== contentToSave || latestRef.current.title !== titleToSave);
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
  }, [slug, router]);
  saveRef.current = handleSave;

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

    if (latestRef.current.content !== savedSnapshotRef.current.content || latestRef.current.title !== savedSnapshotRef.current.title) {
      setCompilationStatus('Saving changes...');
      const saveSuccess = await handleSave();
      if (!saveSuccess) {
        setCompileError('Failed to save document. Please try saving manually.');
        return;
      }
      if (latestRef.current.content !== savedSnapshotRef.current.content || latestRef.current.title !== savedSnapshotRef.current.title) {
        setCompileError('Source changed while saving. Please recompile.');
        setCompilationStatus('');
        return;
      }
      setCompileError(null);
    }

    compileSourceRef.current = savedSnapshotRef.current.content;

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

  // --- Source (.md) download for Markdown documents ---
  const handleDownloadSource = () => {
    const blob = new Blob([code], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- Download handler ---
  const handleDownload = async () => {
    if (!pdfUrl) {
      setErrorModalMessage('Please compile the document first');
      setShowErrorModal(true);
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

  const handleOutlineSelect = useCallback((node: { lineNumber: number }) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.revealLineInCenter(node.lineNumber);
    editor.setPosition({ lineNumber: node.lineNumber, column: 1 });
    editor.focus();
    setCurrentLineNumber(node.lineNumber);
    setShowFileTree(false);
  }, []);

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
    const paraphraseRequestId = paraphraseRequestIdRef;
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      if (completeAbortRef.current) completeAbortRef.current.abort();
      paraphraseAbortRef.current?.abort();
      paraphraseRequestId.current++;
      if (completeDebounceRef.current) clearTimeout(completeDebounceRef.current);
      completeDebounceResolverRef.current?.({ items: [] });
      completeDebounceResolverRef.current = null;
      if (completeProviderDisposableRef.current) {
        completeProviderDisposableRef.current.dispose();
        completeProviderDisposableRef.current = null;
      }
      selectionListenerRef.current?.dispose();
      selectionListenerRef.current = null;
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
    };
  }, []);

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
        format={format}
        fileName={fileName}
        onDownloadSource={isMarkdown ? handleDownloadSource : undefined}
      />

      <div className="flex-1 relative overflow-hidden">
        <FileTree
          isOpen={showFileTree}
          onClose={() => setShowFileTree(false)}
          files={outline}
          onFileSelect={handleOutlineSelect}
          onNewFile={() => router.push('/document')}
          title="Document outline"
          emptyMessage={isMarkdown
            ? 'Use # headings to build a navigable outline.'
            : 'Use \\section, \\subsection, or related headings to build a navigable outline.'}
        />

        <AiWorkspacePanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          autocompleteEnabled={autocompleteEnabled}
          onAutocompleteEnabledChange={(enabled) => setAutocompleteEnabled(enabled)}
          onParaphrase={handleParaphrase}
          paraphraseDisabledReason={paraphraseDisabledReason}
          isAiLoading={isAiLoading}
          aiError={aiError}
          autocompleteNotice={autocompleteNotice}
          hasProposal={!!proposal}
          lastTone={lastToneRef.current}
          pdfIsStale={pdfIsStale}
          hasPdf={!!pdfUrl}
          hasUnsavedChanges={hasUnsavedChanges}
          onCompile={handleCompile}
          onSave={() => { void handleSave(); }}
          onDownloadPdf={() => { void handleDownload(); }}
        />

        <div className={`h-full flex transition-[padding] duration-300 ${showSettings ? 'pr-80 max-[500px]:pr-[90vw]' : ''}`}>
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-full md:w-1/2' : 'w-full'} border-r border-[#3e3e3e] flex flex-col`}>
              {/* AI Toolbar */}
              <div className="min-h-10 bg-[#2d2d2d] border-b border-[#3e3e3e] flex flex-wrap items-center px-3 py-1 gap-2 shrink-0">
                <span title={paraphraseDisabledReason || 'Paraphrase selection'}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleParaphrase('Clearer')}
                  disabled={isAiLoading || !!proposal || !!paraphraseDisabledReason}
                  icon={<Wand2 className="w-3.5 h-3.5" />}
                  title={paraphraseDisabledReason || 'Paraphrase selection (Clearer)'}
                >
                  Paraphrase
                </Button>
                </span>

                <div className="h-4 w-px bg-[#3e3e3e]" />

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500">Tone:</span>
                  {['Clearer', 'Shorter', 'Formal'].map((t) => (
                    <button
                      key={t}
                      onClick={() => handleParaphrase(t)}
                      disabled={isAiLoading || !!proposal || !!paraphraseDisabledReason}
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
                  {autocompleteNotice && <span role="status" className="text-xs text-yellow-400">{autocompleteNotice}</span>}

                  <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
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
                  key={documentId}
                  value={code}
                  onChange={handleCodeChange}
                  language={language}
                  fileName={fileName}
                  modelUri={modelUri}
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
            <div className={`${viewMode === 'split' ? 'hidden md:block md:w-1/2' : 'w-full'} min-w-0`}>
              {isMarkdown ? (
                <MarkdownPreviewPane
                  source={code}
                  pdfUrl={pdfUrl}
                  isCompiling={isCompiling}
                  compilationStatus={compilationStatus}
                  pdfIsStale={pdfIsStale}
                  onCompile={handleCompile}
                  onDownloadPdf={handleDownload}
                />
              ) : (
                <PDFPreview
                  pdfUrl={pdfUrl}
                  isLoading={isCompiling}
                  onCompile={handleCompile}
                  onDownload={handleDownload}
                  statusMessage={compilationStatus}
                  isStale={pdfIsStale}
                  documentKind="LaTeX"
                />
              )}
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
