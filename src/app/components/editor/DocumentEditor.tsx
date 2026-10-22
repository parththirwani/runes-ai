'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import TopNavBar from './TopNavBar';
import WorkspacePanel from './WorkspacePanel';
import FileTabs from './FileTabs';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';
import MarkdownPreviewPane from './MarkdownPreviewPane';
import DiffReview from './DiffReview';
import AiWorkspacePanel from './AiWorkspacePanel';
import InputModal from '../design/InputModal';
import AlertModal from '../design/AlertModal';
import Button from '../design/Button';
import { JobStatus } from '@/src/types/compilation';
import { EditProposal, verifyAcceptance, checkStale, generateProposalId } from '@/src/lib/proposal-engine';
import { analyzeSelection, scanContext, selectionCutsWord } from '@/src/lib/latex-utils';
import { buildLatexOutline } from '@/src/lib/latex-outline';
import { buildMarkdownOutline } from '@/src/lib/markdown-outline';
import { useWorkspace } from '@/src/hooks/useWorkspace';
import { missingReferencesFrom, workspaceClient } from '@/src/lib/workspace-client';
import type { WorkspaceDocumentPayload } from '@/src/lib/workspace-types';
import type { CompileDiagnostic } from '@/src/lib/compile-errors';
import type { MissingReference } from '@/src/lib/workspace-types';
import type { editor } from 'monaco-editor';
import { Wand2, RefreshCw, FileWarning } from 'lucide-react';

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
  initialDocument?: WorkspaceDocumentPayload | null;
}

// Status polling: ask immediately, poll quickly while a compile is normally running, then
// relax. An in flight guard stops slow responses from stacking up on each other.
const POLL_FAST_MS = 200;
const POLL_SLOW_MS = 1000;
const POLL_SLOW_AFTER_MS = 5000;

function pollDelayFor(elapsedMs: number): number {
  return elapsedMs > POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
}

export default function DocumentEditor({ initialDocument }: DocumentEditorProps) {
  const router = useRouter();
  // A brand new document is a one file workspace that has not been persisted yet.
  const syntheticDocument = useMemo<WorkspaceDocumentPayload>(() => initialDocument ?? {
    id: 'new',
    format: 'LATEX',
    title: 'Untitled Document',
    slug: '',
    content: initialCode,
    mainFilePath: 'main.tex',
    updatedAt: new Date().toISOString(),
    mainFile: { path: 'main.tex', revision: 0, checksum: '' },
    files: [{
      id: 'new',
      path: 'main.tex',
      kind: 'tex',
      mimeType: 'text/x-tex',
      sizeBytes: initialCode.length,
      checksum: '',
      revision: 0,
      updatedAt: new Date().toISOString(),
    }],
    tree: [{ name: 'main.tex', path: 'main.tex', type: 'file' }],
  }, [initialDocument]);
  const workspace = useWorkspace(syntheticDocument);

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
  const savedTitleRef = useRef(initialDocument?.title ?? 'Untitled Document');
  const [compileError, setCompileError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([]);
  const [missingRefs, setMissingRefs] = useState<MissingReference[]>([]);
  const [compileInfo, setCompileInfo] = useState<string | null>(null);

  const documentId = syntheticDocument.id;
  const isMarkdown = syntheticDocument.format === 'MARKDOWN';

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [compilationStatus, setCompilationStatus] = useState('');
  const [currentLineNumber, setCurrentLineNumber] = useState(1);

  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState('');

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

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

  useEffect(() => { autocompleteEnabledRef.current = autocompleteEnabled; }, [autocompleteEnabled]);
  const proposalRef = useRef<EditProposal | null>(null);
  useEffect(() => { proposalRef.current = proposal; }, [proposal]);

  const completeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeDebounceResolverRef = useRef<((v: { items: [] }) => void) | null>(null);
  const completeAbortRef = useRef<AbortController | null>(null);
  const completeRequestIdRef = useRef(0);
  const completeProviderDisposableRef = useRef<{ dispose(): void } | null>(null);

  const pendingParaphraseStaleRef = useRef(false);
  const paraphraseAbortRef = useRef<AbortController | null>(null);
  const paraphraseRequestIdRef = useRef(0);

  const [stalenessReason, setStalenessReason] = useState<string | null>(null);

  const activePath = workspace.activePath;
  const activeFile = workspace.activeFile;
  const code = activeFile && !activeFile.binary ? activeFile.content : '';
  const isBinaryActive = Boolean(activeFile?.binary);
  const fileName = activePath || 'main.tex';

  const outline = useMemo(
    () => (isMarkdown ? buildMarkdownOutline : buildLatexOutline)(code, activePath ? activePath.split('/').pop() || workspace.mainFilePath : workspace.mainFilePath, currentLineNumber),
    [code, activePath, currentLineNumber, isMarkdown, workspace.mainFilePath],
  );

  // --- Dirty tracking ---
  useEffect(() => {
    const dirty = workspace.dirtyPaths.length > 0 || title !== savedTitleRef.current;
    setHasUnsavedChanges(dirty);
  }, [workspace.dirtyPaths, title]);

  // Opening a binary asset should not try to edit it.
  useEffect(() => {
    if (isBinaryActive) {
      setParaphraseDisabledReason('Binary file cannot be edited');
      setProposal(null);
    }
  }, [isBinaryActive]);

  // --- Key handlers ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Autosave ---
  useEffect(() => {
    if (workspace.dirtyPaths.length > 0 && slug) {
      const timer = setTimeout(() => { saveRef.current(); }, 30000);
      return () => clearTimeout(timer);
    }
  }, [workspace.dirtyPaths.length, slug, code]);

  // --- Job polling: immediate first check, no overlapping requests ---
  useEffect(() => {
    if (!currentJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const status = await workspaceClient.jobStatus(currentJobId);
        if (cancelled) return;
        switch (status.status) {
          case JobStatus.PENDING:
            setCompilationStatus('Queued...');
            break;
          case JobStatus.PROCESSING:
            setCompilationStatus('Compiling...');
            break;
          case JobStatus.COMPLETED: {
            const timings = status.timings;
            if (timings?.totalMs !== undefined) {
              setCompileInfo('Compiled in ' + timings.totalMs + ' ms (queue ' + (timings.queueWaitMs ?? 0) + ' ms, engine ' + (timings.compiler?.engineMs ?? timings.compileMs ?? 0) + ' ms)');
            }
            setCompilationStatus('');
            setIsCompiling(false);
            await downloadPdfRef.current(currentJobId);
            if (!cancelled) setCurrentJobId(null);
            break;
          }
          case JobStatus.FAILED: {
            setCompilationStatus('');
            setIsCompiling(false);
            const message = status.result?.error || 'Compilation failed';
            setCompileError(message);
            setDiagnostics(status.result?.diagnostics || []);
            setErrorModalMessage(message);
            setShowErrorModal(true);
            setCurrentJobId(null);
            break;
          }
        }
      } catch {
        if (!cancelled) {
          setIsCompiling(false);
          setCurrentJobId(null);
          setCompileError('Job status check failed');
        }
        return;
      } finally {
        inFlight = false;
      }
      if (!cancelled) timer = setTimeout(tick, pollDelayFor(Date.now() - startedAt));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentJobId]);

  // --- Editor ready: register the AI inline completion provider once per document ---
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
      const analysis = analyzeSelection(selected, scanContext(full, start));
      setParaphraseDisabledReason(
        !analysis.eligible ? analysis.reason || 'Unsupported selection' :
        selectionCutsWord(full.slice(0, start), selected, full.slice(end)) ? 'Select complete words' : null,
      );
    });
    cursorListenerRef.current = editorInstance.onDidChangeCursorPosition((event) => {
      setCurrentLineNumber(event.position.lineNumber);
    });

    if (completeProviderDisposableRef.current) {
      completeProviderDisposableRef.current.dispose();
      completeProviderDisposableRef.current = null;
    }

    const provider = monaco.languages.registerInlineCompletionsProvider('latex', {
      provideInlineCompletions: async (model, position, _context, token) => {
        if (!autocompleteEnabledRef.current || proposalRef.current || token.isCancellationRequested || model !== editorInstance.getModel()) return { items: [] };

        const requestId = ++completeRequestIdRef.current;
        completeAbortRef.current?.abort();

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

  // --- Paraphrase action: always operates on the file that is open right now ---
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

    const ctx = scanContext(model.getValue(), startOffset);
    const analysis = analyzeSelection(selectedText, ctx);
    if (!analysis.eligible || selectionCutsWord(model.getValue().slice(0, startOffset), selectedText, model.getValue().slice(endOffset))) {
      setParaphraseDisabledReason(analysis.reason || 'Select complete words');
      return;
    }

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

      if (requestId !== paraphraseRequestIdRef.current ||
          pendingParaphraseStaleRef.current ||
          editor.getModel() !== model || model.getVersionId() !== modelVersion) {
        setAiError('Response discarded — the file was edited while AI was working');
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

  // --- Accept proposal (one undoable edit in the active file only) ---
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

    const fullText = model.getValue();
    const verification = verifyAcceptance(proposal, fullText);

    if (!verification.applied) {
      setStalenessReason(verification.reason || 'Cannot accept');
      setProposal({ ...proposal, state: 'stale' });
      return;
    }

    const actualText = fullText.slice(proposal.range.startOffset, proposal.range.endOffset);
    if (actualText !== proposal.originalText) {
      setStalenessReason('Selection text has been modified');
      setProposal({ ...proposal, state: 'stale' });
      return;
    }

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

    workspace.setContent(activePath, model.getValue());
    setProposal(null);
    setStalenessReason(null);
    setHasUnsavedChanges(true);
  }, [proposal, documentId, workspace, activePath]);

  const handleReject = useCallback(() => {
    setProposal(null);
    setStalenessReason(null);
    setAiError(null);
  }, []);

  const lastToneRef = useRef('Clearer');

  const handleRegenerate = useCallback(() => {
    setProposal(null);
    setStalenessReason(null);
    setAiError(null);
    void handleParaphrase(lastToneRef.current);
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
      setDiagnostics([]);
    } catch (error: unknown) {
      console.error('PDF download error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCompileError(message);
      setErrorModalMessage(message);
      setShowErrorModal(true);
    }
  };
  const downloadPdfRef = useRef<(jobId: string) => Promise<void>>(async () => {});
  downloadPdfRef.current = downloadPDF;

  // --- Save: writes every dirty file in one request, main file included ---
  const handleSave = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    try {
      if (!slug) {
        const contentToSave = code || initialCode;
        const response = await fetch('/api/document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() || 'Untitled Document', content: contentToSave }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create document');
        }
        const data = await response.json();
        setSlug(data.slug);
        workspace.setSlug(data.slug);
        savedTitleRef.current = title;
        router.push('/document/' + data.slug);
        return true;
      }

      const result = await workspace.saveAll();
      if (!result.ok) throw new Error(result.error || 'Failed to save');
      if (title !== savedTitleRef.current) {
        await workspaceClient.saveFiles(slug, [], title.trim() || 'Untitled Document');
        savedTitleRef.current = title;
      }
      setCompileError(null);
      return true;
    } catch (error: unknown) {
      console.error('Save error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setErrorModalMessage(message);
      setShowErrorModal(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [slug, router, title, code, workspace]);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  saveRef.current = handleSave;

  // --- Compile the selected main file ---
  const handleCompile = async () => {
    if (!slug) {
      setCompileError('Please save the document first before compiling');
      return;
    }

    // Pending proposals never compile: only accepted text is sent.
    if (proposal) {
      setProposal(null);
      setStalenessReason(null);
    }

    if (workspace.dirtyPaths.length > 0 || title !== savedTitleRef.current) {
      setCompilationStatus('Saving changes...');
      const saved = await handleSave();
      if (!saved) {
        setCompileError('Failed to save the workspace. Please try saving manually.');
        return;
      }
    }

    setCompileError(null);
    setMissingRefs([]);
    setDiagnostics([]);
    setCompileInfo(null);
    setIsCompiling(true);
    setCompilationStatus('Queueing compilation...');

    try {
      const response = await workspaceClient.compile(slug);
      if (response.snapshot) workspace.setCompiledSnapshot(response.snapshot);
      setCompilationStatus(response.reused === 'new' ? 'Queued...' : 'Reusing compile for identical source');
      setCurrentJobId(response.jobId);
    } catch (error: unknown) {
      setIsCompiling(false);
      const missing = missingReferencesFrom(error);
      if (missing && missing.length > 0) {
        setMissingRefs(missing);
        const message = 'Missing referenced file: ' + missing[0].reference + ' (used by ' + missing[0].file + ')';
        setCompileError(message);
        setErrorModalMessage(message);
        setShowErrorModal(true);
        return;
      }
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : 'Failed to queue compilation';
      if (status === 429) {
        setErrorModalMessage(message);
        setShowErrorModal(true);
      }
      setCompileError(message);
    }
  };

  const handleDownload = async () => {
    if (!pdfUrl) {
      setErrorModalMessage('Please compile the document first');
      setShowErrorModal(true);
      return;
    }
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = (slug || 'document') + '.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadSource = async () => {
    const main = workspace.filesByPath[workspace.mainFilePath];
    const source = main?.loaded
      ? main.content
      : (await workspaceClient.loadFile(slug, workspace.mainFilePath)).content;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug || 'document'}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleTitleSubmit = (newTitle: string) => {
    setTitle(newTitle);
    setShowTitleModal(false);
  };

  const openDiagnostic = useCallback((file: string | null, line: number | null) => {
    if (!file) return;
    void workspace.openFile(file).then(() => {
      const editor = editorRef.current;
      if (!editor || !line) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    });
  }, [workspace]);

  const handleOutlineSelect = useCallback((node: { lineNumber: number }) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(node.lineNumber);
    editor.setPosition({ lineNumber: node.lineNumber, column: 1 });
    editor.focus();
    setCurrentLineNumber(node.lineNumber);
    setShowFileTree(false);
  }, []);

  const handleCodeChange = useCallback((newValue: string) => {
    if (!activePath) return;
    workspace.setContent(activePath, newValue);
    if (proposal) {
      const model = editorRef.current?.getModel();
      if (model) {
        const version = model.getVersionId();
        if (version !== proposal.baseModelVersion) {
          setStalenessReason('The file was edited while the proposal was pending');
          setProposal((prev) => (prev ? { ...prev, state: 'stale' } : null));
        }
      }
    }
    if (isAiLoading) {
      pendingParaphraseStaleRef.current = true;
    }
  }, [activePath, proposal, isAiLoading, workspace]);

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

  const pdfIsStale = Boolean(pdfUrl) && workspace.stalePaths.length > 0;
  const statusLine = [compilationStatus, compileInfo].filter(Boolean).join(' · ');

  return (
    <main id="main" className="flex h-screen flex-col overflow-hidden bg-canvas">
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
        compilationStatus={statusLine}
        format={syntheticDocument.format}
        fileName={isMarkdown ? `${slug || 'document'}.md` : undefined}
        onDownloadSource={isMarkdown ? handleDownloadSource : undefined}
      />

      <div className="flex-1 relative overflow-hidden">
        <WorkspacePanel
          isOpen={showFileTree}
          onClose={() => setShowFileTree(false)}
          tree={workspace.tree}
          files={workspace.filesByPath}
          mainFilePath={workspace.mainFilePath}
          activePath={activePath}
          dirtyPaths={workspace.dirtyPaths}
          stalePaths={workspace.stalePaths}
          slug={slug}
          onOpenFile={(path) => void workspace.openFile(path)}
          onCreateFile={(path) => workspace.createFile(path, path.endsWith('.tex') ? '\\section{' + path.split('/').pop() + '}\n' : '')}
          onUpload={(path, blob) => workspace.uploadFile(path, blob)}
          onRename={(from, to) => workspace.renameFile(from, to)}
          onDelete={(path) => workspace.removeFile(path)}
          onChooseMain={(path) => workspace.chooseMainFile(path)}
          error={workspace.lastError}
          onDismissError={() => workspace.setLastError(null)}
          outline={
            <div>
              {outline.length > 0 ? outline.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => handleOutlineSelect(node)}
                  className="w-full text-left px-3 py-1.5 rounded text-[13px] text-gray-300 hover:bg-[#2a2d2e] flex items-center justify-between gap-2"
                >
                  <span className="truncate">{node.name}</span>
                  <span className="text-[10px] text-gray-500 tabular-nums">L{node.lineNumber}</span>
                </button>
              )) : (
                <p className="px-3 py-4 text-xs leading-5 text-gray-500">
                  {isMarkdown ? 'Use Markdown headings to build an outline of the open file.' : 'Use \\section and related headings to build an outline of the open file.'}
                </p>
              )}
            </div>
          }
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
              <FileTabs
                openPaths={workspace.openPaths}
                files={workspace.filesByPath}
                activePath={activePath}
                mainFilePath={workspace.mainFilePath}
                dirtyPaths={workspace.dirtyPaths}
                onSelect={(path) => void workspace.openFile(path)}
                onClose={workspace.closeFile}
              />

              {/* AI Toolbar */}
              <div className="min-h-10 bg-[#2d2d2d] border-b border-[#3e3e3e] flex flex-wrap items-center px-3 py-1 gap-2 shrink-0">
                <span title={paraphraseDisabledReason || 'Paraphrase selection'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleParaphrase('Clearer')}
                    disabled={isAiLoading || !!proposal || !!paraphraseDisabledReason || isBinaryActive}
                    icon={<Wand2 className="w-3.5 h-3.5" />}
                    title={paraphraseDisabledReason || 'Paraphrase selection (Clearer)'}
                  >
                    Paraphrase
                  </Button>
                </span>

                <div className="h-4 w-px bg-[#3e3e3e]" />

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500">Tone:</span>
                  {['Clearer', 'Shorter', 'Formal'].map((tone) => (
                    <button
                      key={tone}
                      onClick={() => handleParaphrase(tone)}
                      disabled={isAiLoading || !!proposal || !!paraphraseDisabledReason || isBinaryActive}
                      className="text-[11px] px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-[#3e3e3e] transition-colors disabled:opacity-40"
                    >
                      {tone}
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
                  {aiError && !proposal && <span className="text-xs text-yellow-400">{aiError}</span>}
                  {autocompleteNotice && <span role="status" className="text-xs text-yellow-400">{autocompleteNotice}</span>}

                  <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autocompleteEnabled}
                      onChange={(event) => setAutocompleteEnabled(event.target.checked)}
                      className="w-3 h-3 accent-emerald-500"
                    />
                    AI complete
                  </label>
                </div>
              </div>

              {/* Editor, binary preview, or empty state */}
              <div className="flex-1 overflow-hidden">
                {isBinaryActive && activeFile ? (
                  <div className="h-full overflow-auto p-4 flex flex-col items-center gap-3 bg-[#1e1e1e]">
                    {/* The preview is the user's own uploaded file, served raw by the asset route. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={workspaceClient.assetUrl(slug, activeFile.path)}
                      alt={activeFile.path}
                      className="max-w-full border border-[#3e3e3e] rounded bg-white"
                    />
                    <p className="text-xs text-gray-400 text-center">
                      {activeFile.path} · {activeFile.sizeBytes} bytes · {activeFile.mimeType || activeFile.kind}
                    </p>
                    <p className="text-[11px] text-meta">Images are read only. {isMarkdown ? 'Insert them with Markdown image syntax.' : <>Reference them from a .tex file with \includegraphics{'{'}...{'}'}.</>}</p>
                  </div>
                ) : activePath ? (
                  <MonacoEditorWrapper
                    key={documentId}
                    value={code}
                    onChange={handleCodeChange}
                    language={activePath.toLowerCase().endsWith('.md') ? 'markdown' : 'latex'}
                    fileName={fileName}
                    onEditorReady={handleEditorReady}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500 px-6 text-center">
                    Open a file from the workspace panel, or create one to start writing.
                  </div>
                )}
              </div>

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

              {(compileError || diagnostics.length > 0 || missingRefs.length > 0) && (
                <div className="border-t border-red-900/60 bg-red-950/40 max-h-32 overflow-y-auto shrink-0" role="status">
                  <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-red-300">
                    <FileWarning className="w-3.5 h-3.5" />
                    <span>{diagnostics.length || missingRefs.length ? 'Compiler diagnostics' : 'Compile problem'}</span>
                  </div>
                  {compileError && !diagnostics.length && !missingRefs.length && (
                    <p className="px-3 pt-1 text-[11px] text-red-200 whitespace-pre-line">{compileError}</p>
                  )}
                  <ul className="px-3 pb-2 pt-1 space-y-0.5">
                    {missingRefs.map((ref, index) => (
                      <li key={'missing-' + index}>
                        <span className="text-[11px] text-red-200">
                          {ref.file}: {ref.command} target &apos;{ref.reference}&apos; was not found in the workspace
                        </span>
                      </li>
                    ))}
                    {diagnostics.map((diagnostic, index) => (
                      <li key={'diag-' + index}>
                        <button
                          type="button"
                          className="text-[11px] text-left text-red-200 hover:underline"
                          onClick={() => openDiagnostic(diagnostic.file, diagnostic.line)}
                        >
                          {diagnostic.file ? diagnostic.file + (diagnostic.line ? ':' + diagnostic.line : '') : 'engine'}: {diagnostic.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pdfIsStale && pdfUrl && (
                <div className="h-7 bg-yellow-900/30 border-t border-yellow-700/50 flex items-center px-3 text-[11px] text-yellow-400 shrink-0">
                  <span>
                    PDF is older than the current source — {workspace.stalePaths.length} file(s) changed since it was compiled
                  </span>
                </div>
              )}
            </div>
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'hidden md:block md:w-1/2' : 'w-full'}`}>
              {isMarkdown ? (
                <MarkdownPreviewPane
                  source={workspace.filesByPath[workspace.mainFilePath]?.content ?? ''}
                  pdfUrl={pdfUrl}
                  isCompiling={isCompiling}
                  compilationStatus={statusLine}
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
                  statusMessage={statusLine}
                  isStale={pdfIsStale}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <InputModal
        isOpen={showTitleModal}
        onClose={() => setShowTitleModal(false)}
        onSubmit={handleTitleSubmit}
        label="Document title"
        title="Edit Document Title"
        description="Enter a new title for your document"
        placeholder="e.g., Research Paper, Resume, Report..."
        defaultValue={title}
        submitText="Save"
        maxLength={30}
        validation={(value: string) => (value.length < 3 ? 'Title must be at least 3 characters' : null)}
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
    </main>
  );
}
