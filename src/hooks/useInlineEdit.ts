'use client';

// AI inline edit controller. Owns everything the anchored edit flow needs that
// is neither a pure decision nor markup: the triggers (pointer, touch, and
// Ctrl/Cmd+K inside Monaco only), the anchor captured from the live model, the
// streamed request (with Stop and abort-on-typing), the per-change hunk model,
// the final single undoable Monaco edit after a full anchor recheck, and the
// anchored placement that survives scrolling and resizing. Every rule it applies
// lives in a pure module (inline-edit-anchor / -state / -selection / -hunks /
// -review / -stream), so this file only moves data between Monaco and React.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { editor } from 'monaco-editor';
import {
  anchorIsStale,
  buildInlineEditAnchor,
  evaluateInlineEditCaret,
  evaluateInlineEditRange,
  type InlineEditRange,
} from '@/src/lib/inline-edit-anchor';
import {
  INLINE_EDIT_MAX_INSTRUCTION_CHARS,
  positionAnchoredCard,
  validateFreeInstruction,
  type InlineEditAnchor,
  type InlineEditFormat,
  type InlineEditQuickActionId,
} from '@/src/lib/inline-edit-selection';
import {
  INITIAL_INLINE_EDIT_STATE,
  inlineEditReducer,
  suppressesGhostText,
} from '@/src/lib/inline-edit-state';
import { maskedTokensForPreview, readInlineEditStream, restoreMaskedPreview } from '@/src/lib/inline-edit-stream';
import { buildStreamingPreview, reviewAnnouncement, summarizeReview } from '@/src/lib/inline-edit-review';
import {
  buildInlineEditHunks,
  finalizeInlineEditReplacement,
  withAllDecisions,
  withHunkDecision,
  type InlineEditHunkModel,
} from '@/src/lib/inline-edit-hunks';
import type { DiffToken } from '@/src/lib/proposal-engine';

export type InlineEditSurface = 'none' | 'bubble' | 'prompt' | 'streaming' | 'review' | 'error' | 'receipt';

export type InlineEditReceipt = {
  acceptedCount: number;
  total: number;
  keptOriginal: boolean;
};

export type UseInlineEditOptions = {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  /** Bumped whenever the Monaco instance mounts so triggers re-attach. */
  editorRevision: number;
  documentId: string;
  activePath: string;
  format: InlineEditFormat;
  canEdit: boolean;
  isBinaryActive: boolean;
  /** Element the anchored card is positioned inside (the editor area). */
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Marks the active file dirty after a committed edit. */
  onModelChanged: (path: string, text: string) => void;
};

const DEFAULT_SIZES: Record<Exclude<InlineEditSurface, 'none'>, { width: number; height: number }> = {
  bubble: { width: 130, height: 28 },
  prompt: { width: 384, height: 232 },
  streaming: { width: 384, height: 288 },
  review: { width: 416, height: 360 },
  error: { width: 352, height: 96 },
  receipt: { width: 320, height: 44 },
};

const RECEIPT_AUTO_DISMISS_MS = 8000;
const STOPPED_MESSAGE = 'Stopped — the partial edit was discarded because only a finished edit can be validated';

function sameRange(a: InlineEditRange | null, b: InlineEditRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startOffset === b.startOffset && a.endOffset === b.endOffset && a.text === b.text;
}

export function useInlineEdit(options: UseInlineEditOptions) {
  const {
    editorRef, editorRevision, documentId, activePath, format,
    canEdit, isBinaryActive, overlayRef, onModelChanged,
  } = options;

  const [state, dispatch] = useReducer(inlineEditReducer, INITIAL_INLINE_EDIT_STATE);
  const [bubbleRange, setBubbleRange] = useState<InlineEditRange | null>(null);
  const [instruction, setInstruction] = useState('');
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [previewTokens, setPreviewTokens] = useState<DiffToken[]>([]);
  const [hunkModel, setHunkModel] = useState<InlineEditHunkModel | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [applyBlockedReason, setApplyBlockedReason] = useState<string | null>(null);
  const [reviewStaleReason, setReviewStaleReason] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InlineEditReceipt | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const [surfaceNode, setSurfaceNode] = useState<HTMLDivElement | null>(null);

  // Latest values for listeners and async continuations, without re-attaching.
  const stateRef = useRef(state);
  stateRef.current = state;
  const hunkModelRef = useRef(hunkModel);
  hunkModelRef.current = hunkModel;
  const bubbleRangeRef = useRef(bubbleRange);
  bubbleRangeRef.current = bubbleRange;
  const formatRef = useRef(format);
  formatRef.current = format;
  const pathRef = useRef(activePath);
  pathRef.current = activePath;
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const binaryRef = useRef(isBinaryActive);
  binaryRef.current = isBinaryActive;
  const onModelChangedRef = useRef(onModelChanged);
  onModelChangedRef.current = onModelChanged;

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const anchorOf = useCallback((): InlineEditAnchor | null => {
    const current = stateRef.current;
    if (current.phase === 'prompt' || current.phase === 'requesting' || current.phase === 'review') return current.anchor;
    if (current.phase === 'error') return current.anchor;
    return null;
  }, []);

  const abortActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const modelNow = useCallback((): {
    documentId: string; path: string; modelUri: string; modelVersion: number; source: string;
  } | null => {
    const model = editorRef.current?.getModel();
    if (!model) return null;
    return {
      documentId: documentIdRef.current,
      path: pathRef.current,
      modelUri: model.uri.toString(),
      modelVersion: model.getVersionId(),
      source: model.getValue(),
    };
  }, [editorRef]);

  const clearSurfaces = useCallback(() => {
    setBubbleRange(null);
    setPreviewTokens([]);
    setHunkModel(null);
    setFocusIndex(null);
    setApplyBlockedReason(null);
    setReviewStaleReason(null);
    setInstructionError(null);
  }, []);

  const focusAnchor = useCallback((anchor: InlineEditAnchor | null) => {
    const instance = editorRef.current;
    const model = instance?.getModel();
    if (!instance || !model || !anchor) return;
    if (model.uri.toString() !== anchor.modelUri) return;
    const startPos = model.getPositionAt(anchor.startOffset);
    const endPos = model.getPositionAt(anchor.endOffset);
    const range = {
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
    };
    instance.revealRangeInCenterIfOutsideViewport(range);
    instance.setSelection(range);
    instance.focus();
  }, [editorRef]);

  // --- Opening -------------------------------------------------------------

  const openWithRange = useCallback((range: InlineEditRange) => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    abortActive();
    clearSurfaces();
    setInstruction('');
    setReceipt(null);
    dispatch({
      type: 'open',
      anchor: buildInlineEditAnchor(
        {
          documentId: documentIdRef.current,
          path: pathRef.current,
          modelUri: model.uri.toString(),
          modelVersion: model.getVersionId(),
          format: formatRef.current,
        },
        range,
      ),
    });
  }, [abortActive, clearSurfaces, editorRef]);

  /** Ctrl/Cmd+K and any explicit trigger: selection first, sentence at caret second. */
  const openFromEditor = useCallback(() => {
    if (!canEditRef.current) {
      dispatch({ type: 'notice', message: 'This document is read-only — AI edits are unavailable' });
      return;
    }
    if (binaryRef.current) {
      dispatch({ type: 'notice', message: 'Binary file cannot be edited' });
      return;
    }
    if (!pathRef.current) {
      dispatch({ type: 'notice', message: 'Open a file to edit with AI' });
      return;
    }
    const instance = editorRef.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    const selection = instance.getSelection();
    if (!selection) return;
    const source = model.getValue();
    const start = model.getOffsetAt(selection.getStartPosition());
    const end = model.getOffsetAt(selection.getEndPosition());
    const evaluation = end > start
      ? evaluateInlineEditRange({ source, format: formatRef.current, selectionStart: start, selectionEnd: end })
      : evaluateInlineEditCaret({ source, format: formatRef.current, caretOffset: start });
    if (!evaluation.ok) {
      dispatch({ type: 'notice', message: evaluation.reason });
      return;
    }
    openWithRange(evaluation.range);
  }, [editorRef, openWithRange]);

  /** Bubble tap: pointer and touch users get a real button, not a hover. */
  const openFromBubble = useCallback(() => {
    const stored = bubbleRangeRef.current;
    if (!stored) {
      openFromEditor();
      return;
    }
    const model = editorRef.current?.getModel();
    if (!model) return;
    const evaluation = evaluateInlineEditRange({
      source: model.getValue(),
      format: formatRef.current,
      selectionStart: stored.startOffset,
      selectionEnd: stored.endOffset,
    });
    if (!evaluation.ok) {
      setBubbleRange(null);
      dispatch({ type: 'notice', message: evaluation.reason });
      return;
    }
    openWithRange(evaluation.range);
  }, [editorRef, openFromEditor, openWithRange]);

  // --- Request -------------------------------------------------------------

  const requestEdit = useCallback(async (
    anchor: InlineEditAnchor,
    payload: { mode: 'quickAction'; action: InlineEditQuickActionId } | { mode: 'instruction'; instruction: string },
  ) => {
    const model = editorRef.current?.getModel();
    if (!model) return;

    abortActive();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPreviewTokens([]);
    setApplyBlockedReason(null);
    setReviewStaleReason(null);
    dispatch({ type: 'submit', requestId });

    const source = model.getValue();
    const before = source.slice(Math.max(0, anchor.startOffset - 1000), anchor.startOffset);
    const after = source.slice(anchor.endOffset, anchor.endOffset + 1000);

    // The plan requires typing during a request to invalidate the response.
    const contentListener = model.onDidChangeContent(() => {
      if (requestIdRef.current !== requestId) return;
      abortActive();
      dispatch({ type: 'failure', requestId, message: 'Response discarded — the file was edited while AI was working' });
    });

    let terminal = false;
    try {
      const response = await fetch('/api/ai/inline-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: anchor.documentId,
          selectedText: anchor.originalText,
          before,
          after,
          ...payload,
          requestId: String(requestId),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        terminal = true;
        let message = 'Failed to get an AI edit';
        try {
          const data = await response.json();
          if (typeof data?.error === 'string') message = data.error;
        } catch { /* a non-JSON refusal still needs the honest generic line */ }
        dispatch({
          type: 'failure',
          requestId,
          message: response.status === 429 ? 'Rate limit reached. Please wait before trying again.' : message,
        });
        return;
      }

      const tokens = maskedTokensForPreview(anchor.originalText, anchor.format);
      let masked = '';
      for await (const event of readInlineEditStream(response.body)) {
        if (requestIdRef.current !== requestId) break;
        if (event.type === 'delta') {
          masked += event.text;
          const preview = restoreMaskedPreview(masked, tokens);
          setPreviewTokens(buildStreamingPreview(anchor.originalText, preview.visible).tokens);
          continue;
        }
        terminal = true;
        if (event.type === 'done') {
          // The complete suggestion is selected by default. Readers can keep
          // individual original spans before committing it in one action.
          setHunkModel(withAllDecisions(buildInlineEditHunks(anchor.originalText, event.replacementText), 'accepted'));
          setFocusIndex(null);
          setPreviewTokens([]);
          dispatch({ type: 'result', requestId, replacementText: event.replacementText });
        } else if (event.type === 'noop') {
          dispatch({ type: 'failure', requestId, message: event.explanation || 'No change suggested' });
        } else {
          dispatch({ type: 'failure', requestId, message: event.message });
        }
      }
      if (!terminal && requestIdRef.current === requestId && !controller.signal.aborted) {
        dispatch({ type: 'failure', requestId, message: 'AI stream ended before a validated replacement arrived' });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (requestIdRef.current === requestId) {
        dispatch({ type: 'failure', requestId, message: 'Network error. Please try again.' });
      }
    } finally {
      contentListener.dispose();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [abortActive, editorRef]);

  const submitQuickAction = useCallback((action: InlineEditQuickActionId) => {
    const current = stateRef.current;
    if (current.phase !== 'prompt') return;
    void requestEdit(current.anchor, { mode: 'quickAction', action });
  }, [requestEdit]);

  const submitInstruction = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== 'prompt') return;
    const validated = validateFreeInstruction(instruction);
    if (!validated.ok) {
      setInstructionError(validated.reason);
      return;
    }
    setInstructionError(null);
    void requestEdit(current.anchor, { mode: 'instruction', instruction: validated.instruction });
  }, [instruction, requestEdit]);

  const stop = useCallback(() => {
    if (stateRef.current.phase !== 'requesting') return;
    abortActive();
    dispatch({ type: 'stop' });
    setPreviewTokens([]);
    // Only a completed edit can be validated against protected syntax.
    dispatch({ type: 'notice', message: STOPPED_MESSAGE });
  }, [abortActive]);

  const dismiss = useCallback(() => {
    if (stateRef.current.phase === 'requesting') {
      stop();
      return;
    }
    const anchor = anchorOf();
    abortActive();
    dispatch({ type: 'dismiss' });
    clearSurfaces();
    setReceipt(null);
    focusAnchor(anchor);
  }, [abortActive, anchorOf, clearSurfaces, focusAnchor, stop]);

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
    setApplyBlockedReason(null);
    setReviewStaleReason(null);
  }, []);

  // --- Review decisions ----------------------------------------------------

  const decide = useCallback((hunkId: string, decision: 'accepted' | 'rejected') => {
    setApplyBlockedReason(null);
    setHunkModel((prev) => (prev ? withHunkDecision(prev, hunkId, decision) ?? prev : prev));
  }, []);

  // --- Apply: one undoable Monaco edit after a full anchor recheck ---------

  const apply = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== 'review') return;
    const instance = editorRef.current;
    const model = instance?.getModel();
    const now = modelNow();
    const hunk = hunkModelRef.current;
    if (!instance || !model || !now || !hunk) return;

    const stale = anchorIsStale(current.anchor, now);
    if (stale) {
      setReviewStaleReason(stale);
      return;
    }

    const finalized = finalizeInlineEditReplacement(hunk, current.anchor.format);
    if (!finalized.ok) {
      setApplyBlockedReason(finalized.reason);
      return;
    }

    const total = hunk.hunks.length;
    const anchor = current.anchor;
    if (!finalized.changed) {
      // Reject-all: zero bytes are committed and the receipt says so.
      dispatch({ type: 'applied' });
      clearSurfaces();
      setReceipt({ acceptedCount: 0, total, keptOriginal: true });
      focusAnchor(anchor);
      return;
    }

    const startPos = model.getPositionAt(anchor.startOffset);
    const endPos = model.getPositionAt(anchor.endOffset);
    instance.pushUndoStop();
    instance.executeEdits('ai-inline-edit', [{
      range: {
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      },
      text: finalized.text,
      forceMoveMarkers: true,
    }]);
    instance.pushUndoStop();

    onModelChangedRef.current(pathRef.current, model.getValue());
    dispatch({ type: 'applied' });
    clearSurfaces();
    setReceipt({ acceptedCount: finalized.acceptedCount, total, keptOriginal: false });
    instance.focus();
  }, [clearSurfaces, editorRef, focusAnchor, modelNow]);

  const undoApply = useCallback(() => {
    const instance = editorRef.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    instance.trigger('ai-inline-edit', 'undo', null);
    onModelChangedRef.current(pathRef.current, model.getValue());
    setReceipt(null);
    instance.focus();
  }, [editorRef]);

  // --- Triggers ------------------------------------------------------------

  useEffect(() => {
    const instance = editorRef.current;
    const node = instance?.getDomNode();
    if (!instance || !node) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const hideBubble = () => setBubbleRange((prev) => (prev === null ? prev : null));

    const refreshBubble = () => {
      const model = instance.getModel();
      if (!canEditRef.current || binaryRef.current || stateRef.current.phase !== 'idle' || !model) {
        hideBubble();
        return;
      }
      const selection = instance.getSelection();
      if (!selection || selection.isEmpty()) {
        hideBubble();
        return;
      }
      const start = model.getOffsetAt(selection.getStartPosition());
      const end = model.getOffsetAt(selection.getEndPosition());
      const evaluation = evaluateInlineEditRange({
        source: model.getValue(),
        format: formatRef.current,
        selectionStart: start,
        selectionEnd: end,
      });
      const next = evaluation.ok ? evaluation.range : null;
      setBubbleRange((prev) => (sameRange(prev, next) ? prev : next));
    };

    // One tick later: Monaco has then finished applying the pointer selection.
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshBubble, 0);
    };

    const onKeyDownCapture = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K') && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        openFromEditor();
      }
    };

    const selectionChange = instance.onDidChangeCursorSelection(scheduleRefresh);
    const modelChange = instance.onDidChangeModel(hideBubble);
    node.addEventListener('mouseup', scheduleRefresh);
    node.addEventListener('touchend', scheduleRefresh);
    node.addEventListener('keydown', onKeyDownCapture, true);

    return () => {
      if (timer) clearTimeout(timer);
      selectionChange.dispose();
      modelChange.dispose();
      node.removeEventListener('mouseup', scheduleRefresh);
      node.removeEventListener('touchend', scheduleRefresh);
      node.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, [editorRef, editorRevision, openFromEditor]);

  // Escape closes whatever is open. Attached only while something is open, so
  // Monaco keeps its own Escape behaviour (suggest widget) the rest of the time.
  useEffect(() => {
    if (state.phase === 'idle' && !receipt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismiss, receipt, state.phase]);

  // File switch, document switch, format change, read-only toggle, unmount.
  useEffect(() => {
    abortActive();
    dispatch({ type: 'contextChanged' });
    clearSurfaces();
    setReceipt(null);
    setInstruction('');
  }, [abortActive, clearSurfaces, activePath, canEdit, documentId, format, isBinaryActive]);

  useEffect(() => () => abortActive(), [abortActive]);

  // While a review is open, any model change makes it inert.
  useEffect(() => {
    if (state.phase !== 'review') return;
    const anchor = state.anchor;
    const model = editorRef.current?.getModel();
    if (!model) return;
    const check = () => {
      const now = modelNow();
      setReviewStaleReason(now ? anchorIsStale(anchor, now) : 'The editor is no longer available');
    };
    check();
    const listener = model.onDidChangeContent(check);
    return () => listener.dispose();
  }, [editorRef, modelNow, state]);

  // The receipt is a transient confirmation, not a modal.
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setReceipt(null), RECEIPT_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [receipt]);

  // --- Anchored placement --------------------------------------------------

  const surface: InlineEditSurface = useMemo(() => {
    if (state.phase === 'prompt') return 'prompt';
    if (state.phase === 'requesting') return 'streaming';
    if (state.phase === 'review') return 'review';
    if (state.phase === 'error') return 'error';
    if (receipt) return 'receipt';
    if (bubbleRange) return 'bubble';
    return 'none';
  }, [bubbleRange, receipt, state.phase]);

  const surfaceAnchor: InlineEditAnchor | null = state.phase === 'prompt' ||
    state.phase === 'requesting' || state.phase === 'review'
    ? state.anchor
    : state.phase === 'error'
      ? state.anchor
      : null;

  const surfaceKindRef = useRef(surface);
  surfaceKindRef.current = surface;
  const surfaceAnchorRef = useRef(surfaceAnchor);
  surfaceAnchorRef.current = surfaceAnchor;

  /** Callback ref on the rendered card so placement can use its real size. */
  const setSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    setSurfaceNode((prev) => (prev === node ? prev : node));
  }, []);

  const recomputePlacement = useCallback(() => {
    const instance = editorRef.current;
    const container = overlayRef.current;
    const kind = surfaceKindRef.current;
    if (!instance || !container || kind === 'none') {
      setPlacement((prev) => (prev === null ? prev : null));
      return;
    }
    const model = instance.getModel();
    if (!model) return;
    // A refusal without an anchor (an ineligible trigger) still needs a place
    // on screen: fall back to the caret, so the card never floats detached from
    // the text the user was pointing at.
    const caret = instance.getPosition() ?? { lineNumber: 1, column: 1 };
    const offset = kind === 'bubble'
      ? bubbleRangeRef.current?.endOffset ?? model.getOffsetAt(caret)
      : surfaceAnchorRef.current?.endOffset ?? model.getOffsetAt(caret);

    const position = model.getPositionAt(offset);
    const visible = instance.getScrolledVisiblePosition(position);
    const editorNode = instance.getDomNode();
    const editorBox = editorNode?.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const shiftX = editorBox ? editorBox.left - containerBox.left : 0;
    const shiftY = editorBox ? editorBox.top - containerBox.top : 0;

    let rect;
    if (visible) {
      rect = {
        top: visible.top + shiftY,
        bottom: visible.top + visible.height + shiftY,
        left: visible.left + shiftX,
      };
    } else {
      // The anchor scrolled out of view: pin the card to the near edge so it
      // stays reachable instead of drifting off screen.
      const layout = instance.getLayoutInfo();
      const firstVisibleLine = instance.getVisibleRanges()[0]?.startLineNumber ?? 1;
      rect = position.lineNumber < firstVisibleLine
        ? { top: shiftY, bottom: shiftY + 8, left: shiftX + 16 }
        : { top: shiftY + layout.height - 24, bottom: shiftY + layout.height - 8, left: shiftX + 16 };
    }

    const measured = surfaceNode?.getBoundingClientRect();
    const size = measured && measured.width > 0
      ? { width: measured.width, height: measured.height }
      : DEFAULT_SIZES[kind];
    const next = positionAnchoredCard(rect, { width: containerBox.width, height: containerBox.height }, size);
    setPlacement((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [editorRef, overlayRef, surfaceNode]);

  // Paint first, then place: the measured card size is what keeps clamping true.
  useLayoutEffect(() => {
    recomputePlacement();
  }, [recomputePlacement, surface, surfaceAnchor, hunkModel, previewTokens]);

  useEffect(() => {
    const instance = editorRef.current;
    const container = overlayRef.current;
    if (!instance || !container || surface === 'none') return;
    const scroll = instance.onDidScrollChange(recomputePlacement);
    const layout = instance.onDidLayoutChange(recomputePlacement);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recomputePlacement) : null;
    observer?.observe(container);
    window.addEventListener('resize', recomputePlacement);
    return () => {
      scroll.dispose();
      layout.dispose();
      observer?.disconnect();
      window.removeEventListener('resize', recomputePlacement);
    };
  }, [editorRef, editorRevision, overlayRef, recomputePlacement, surface]);

  const announcement = useMemo(() => {
    if (state.phase === 'requesting') return 'AI is writing the replacement. The source is unchanged until you accept.';
    if (state.phase === 'review' && hunkModel) return reviewAnnouncement(summarizeReview(hunkModel));
    if (state.phase === 'error') return state.message;
    if (receipt) return receipt.keptOriginal ? 'Kept the original' : `Applied ${receipt.acceptedCount} of ${receipt.total}`;
    return '';
  }, [hunkModel, receipt, state]);

  return {
    state,
    surface,
    surfaceRef: setSurfaceRef,
    placement,
    anchor: surfaceAnchor,
    instruction,
    instructionError,
    instructionLimit: INLINE_EDIT_MAX_INSTRUCTION_CHARS,
    setInstruction,
    previewTokens,
    hunkModel,
    focusIndex,
    setFocusIndex,
    blockedReason: applyBlockedReason ?? reviewStaleReason,
    receipt,
    announcement,
    ghostSuppressed: suppressesGhostText(state),
    canRetry: state.phase === 'error' && state.anchor !== null,
    openFromEditor,
    openFromBubble,
    submitQuickAction,
    submitInstruction,
    stop,
    dismiss,
    retry,
    decide,
    apply,
    undoApply,
  };
}

export type InlineEditController = ReturnType<typeof useInlineEdit>;
