'use client';

// Ghost text autocomplete controller. Owns the Monaco inline-completion
// provider lifecycle for the Ghost text plan section: the 450 ms debounce,
// the streamed request against /api/ai/complete (with a single-response
// fallback and progressive word reveal), the local consumption of typed
// characters that match the ghost, the abort rules that keep late chunks
// from ever inserting into a changed model, and the status chip with polite
// announcements. Every rule it applies lives in src/lib/ghost-text.ts, so
// this file only moves data between Monaco, the route, and React.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { editor, languages } from 'monaco-editor';
import { scanContext } from '@/src/lib/latex-utils';
import { markdownLineIsProse, scanMarkdownContext } from '@/src/lib/markdown-utils';
import {
  completionNoticeForStatus,
  consumeGhostByTyping,
  ghostAnnouncement,
  GHOST_DISMISSED_ANNOUNCEMENT,
  GHOST_TEXT_DEBOUNCE_MS,
  GHOST_TEXT_MAX_INSERTION,
  ghostStreamKey,
  isRetryableCompletionStatus,
  nextGhostWord,
  readCompleteStream,
  type GhostChipPhase,
} from '@/src/lib/ghost-text';

type MonacoModel = editor.ITextModel;
type GhostPosition = { lineNumber: number; column: number };
type GhostItem = { insertText: string; range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } };
type GhostResult = { items: GhostItem[] };

const EMPTY_RESULT: GhostResult = { items: [] };

function ghostAt(position: GhostPosition, text: string): GhostResult {
  return {
    items: [{
      insertText: text,
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column,
        endColumn: position.column,
      },
    }],
  };
}

export type GhostTextOptions = {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  /** Bumped whenever the Monaco instance mounts so the key handler re-attaches. */
  editorRevision: number;
  documentId: string;
  isMarkdown: boolean;
  canEdit: boolean;
  autocompleteEnabled: boolean;
  /** True while the inline-edit prompt, request, or review surface is open. */
  inlineEditOpen: boolean;
  /** Keeps the side panel's existing "AI limited" notice informed. */
  onNotice: (notice: string | null) => void;
};

export type GhostTextController = {
  /** Stable provider object to register with registerInlineCompletionsProvider. */
  provider: languages.InlineCompletionsProvider;
  chipPhase: GhostChipPhase;
  modelName: string | null;
  announcement: string | null;
  /** Chip tap-to-accept (touch): inserts the visible suggestion, focus stays. */
  accept: () => void;
  /** Chip Retry: clears the failure notice and asks Monaco to re-suggest. */
  retry: () => void;
  /** Abort everything in flight; blur, file switch, disable, unmount use this. */
  cancel: () => void;
};

type ReadyGhost = {
  uri: string;
  startOffset: number;
  text: string;
};

type InFlight = {
  key: string;
  requestId: number;
  controller: AbortController;
  preview: string;
  terminal: boolean;
  finalText: string | null;
  resolvers: ((result: GhostResult) => void)[];
};

/**
 * Split a suggestion into the word a Cmd/Ctrl+Right accept takes and the
 * remainder that stays visible. Pure; exported for tests.
 */
export function splitGhostWord(suggestion: string): { accepted: string; remainder: string } {
  return nextGhostWord(suggestion);
}

export function useGhostText(options: GhostTextOptions): GhostTextController {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [chipPhase, setChipPhase] = useState<GhostChipPhase>('idle');
  const [modelName, setModelName] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const pendingResolversRef = useRef<((result: GhostResult) => void)[]>([]);
  const inflightRef = useRef<InFlight | null>(null);
  const readyGhostRef = useRef<ReadyGhost | null>(null);
  const ensureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chipPhaseRef = useRef<GhostChipPhase>('idle');

  const applyChip = useCallback((phase: GhostChipPhase, announce: boolean) => {
    chipPhaseRef.current = phase;
    setChipPhase(phase);
    if (announce) {
      const text = ghostAnnouncement(phase);
      if (text) setAnnouncement(text);
    }
  }, []);

  /** The world this request belongs to must still be on screen. */
  const isCurrent = useCallback((requestId: number, model: MonacoModel, position: GhostPosition) => {
    const opts = optionsRef.current;
    const editorInstance = opts.editorRef.current;
    if (requestId !== requestIdRef.current || !editorInstance || editorInstance.getModel() !== model) return false;
    if (!opts.autocompleteEnabled || !opts.canEdit || opts.inlineEditOpen) return false;
    if (editorInstance.getSelection()?.isEmpty() === false) return false;
    const caret = editorInstance.getPosition();
    return caret?.lineNumber === position.lineNumber && caret?.column === position.column;
  }, []);

  const abortInflight = useCallback(() => {
    const inflight = inflightRef.current;
    if (!inflight) return;
    inflightRef.current = null;
    inflight.terminal = true;
    inflight.controller.abort();
    for (const resolve of inflight.resolvers.splice(0)) resolve(EMPTY_RESULT);
  }, []);

  /** Abandon a waiting debounce timer (its promises must never hang). */
  const clearPendingDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingKeyRef.current = null;
    for (const resolve of pendingResolversRef.current.splice(0)) resolve(EMPTY_RESULT);
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    clearPendingDebounce();
    abortInflight();
    readyGhostRef.current = null;
    if (ensureTimerRef.current) { clearInterval(ensureTimerRef.current); ensureTimerRef.current = null; }
    if (chipPhaseRef.current !== 'idle') applyChip('idle', false);
  }, [abortInflight, applyChip, clearPendingDebounce]);

  // Autocomplete disabled, loss of edit rights, or an open inline-edit
  // prompt/review must clear the suggestion immediately, not only on the
  // next trigger.
  useEffect(() => {
    if (!options.autocompleteEnabled || !options.canEdit || options.inlineEditOpen) {
      cancel();
    }
  }, [options.autocompleteEnabled, options.canEdit, options.inlineEditOpen, cancel]);

  /** Ask Monaco to re-ask the provider so a parked suggestion reappears. */
  const retrigger = useCallback(() => {
    const editorInstance = optionsRef.current.editorRef.current;
    if (editorInstance?.getAction('editor.action.inlineSuggest.trigger')) {
      editorInstance.trigger('ghost-text-stream', 'editor.action.inlineSuggest.trigger', { explicit: true });
    }
  }, []);

  /**
   * Monaco sometimes cancels the in-flight provider request right before we
   * settle it (selection churn, quick retriggers), which drops the result
   * before it ever reaches the view. The chip says ready in that moment, so
   * nudge Monaco until the ghost text node actually exists in the DOM (the
   * view is the only honest paint signal), up to ~6 seconds; any state
   * change stops the loop.
   */
  const ensurePainted = useCallback(() => {
    if (ensureTimerRef.current) clearInterval(ensureTimerRef.current);
    let ticks = 0;
    ensureTimerRef.current = setInterval(() => {
      ticks += 1;
      if (ticks > 24 || !readyGhostRef.current || chipPhaseRef.current !== 'ready'
        || typeof document !== 'undefined' && document.querySelector('.ghost-text-decoration')) {
        if (ensureTimerRef.current) clearInterval(ensureTimerRef.current);
        ensureTimerRef.current = null;
        return;
      }
      retrigger();
    }, 250);
  }, [retrigger]);

  const runRequest = useCallback(async (
    requestId: number,
    model: MonacoModel,
    position: GhostPosition,
    key: string,
  ) => {
    const { documentId } = optionsRef.current;
    const offset = model.getOffsetAt(position);
    const full = model.getValue();
    const prefix = full.slice(Math.max(0, offset - 2000), offset);
    const suffix = full.slice(offset, offset + 1000);

    const controller = new AbortController();
    abortInflight();
    const inflight: InFlight = {
      key, requestId, controller,
      preview: '', terminal: false, finalText: null, resolvers: [],
    };
    abortInflight();
    inflightRef.current = inflight;
    applyChip('thinking', true);

    const settle = (text: string | null) => {
      for (const resolve of inflight.resolvers.splice(0)) {
        resolve(text ? ghostAt(position, text) : EMPTY_RESULT);
      }
    };

    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          prefix: prefix.slice(-2000),
          suffix: suffix.slice(0, 1000),
          requestId: String(requestId),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Pre-stream refusals stay plain JSON statuses, same as inline edit.
        inflight.terminal = true;
        settle(null);
        if (isCurrent(requestId, model, position)) {
          settle(null);
        if (isRetryableCompletionStatus(res.status)) {
            optionsRef.current.onNotice(completionNoticeForStatus(res.status));
            applyChip('unavailable', true);
          } else {
            applyChip('none', true);
          }
        }
        return;
      }

      if ((res.headers.get('content-type') ?? '').includes('application/x-ndjson') && res.body) {
        for await (const event of readCompleteStream(res.body)) {
          if (inflight.terminal || requestIdRef.current !== requestId) break;
          if (event.type === 'delta') {
            inflight.preview = (inflight.preview + event.text).slice(0, GHOST_TEXT_MAX_INSERTION);
          } else if (event.type === 'done') {
            inflight.terminal = true;
            if (event.insertion && event.insertion.length <= GHOST_TEXT_MAX_INSERTION) {
              inflight.preview = event.insertion;
              inflight.finalText = event.insertion;
              setModelName(`${event.provider} · ${event.model}`);
              if (isCurrent(requestId, model, position)) {
                readyGhostRef.current = { uri: model.uri.toString(), startOffset: offset, text: event.insertion };
                applyChip('ready', true);
                settle(event.insertion);
                retrigger();
                ensurePainted();
              } else {
                settle(null);
              }
            } else {
              if (event.insertion) setModelName(`${event.provider} · ${event.model}`);
              if (isCurrent(requestId, model, position)) applyChip('none', true);
              settle(null);
            }
          } else {
            inflight.terminal = true;
            inflight.preview = '';
            readyGhostRef.current = null;
            settle(null);
            if (isCurrent(requestId, model, position)) {
              optionsRef.current.onNotice(completionNoticeForStatus(502));
              applyChip('unavailable', true);
            }
          }
        }
        if (!inflight.terminal) {
          inflight.terminal = true;
          settle(null);
          if (isCurrent(requestId, model, position) && chipPhaseRef.current === 'thinking') applyChip('none', true);
        }
        return;
      }

      // Single-response fallback (deployment without streaming support).
      const data = await res.json() as { insertion?: string | null; provider?: string; model?: string };
      inflight.terminal = true;
      const insertion = typeof data.insertion === 'string' && data.insertion.length <= GHOST_TEXT_MAX_INSERTION
        ? data.insertion : null;
      if (data.provider && data.model) setModelName(`${data.provider} · ${data.model}`);
      if (insertion && isCurrent(requestId, model, position)) {
        inflight.preview = insertion;
        inflight.finalText = insertion;
        readyGhostRef.current = { uri: model.uri.toString(), startOffset: offset, text: insertion };
        applyChip('ready', true);
        settle(insertion);
        retrigger();
        ensurePainted();
      } else {
        settle(null);
        if (isCurrent(requestId, model, position)) applyChip('none', true);
      }
    } catch {
      inflight.terminal = true;
      settle(null);
    } finally {
      clearTimeout(timeoutId);
    }
  }, [abortInflight, applyChip, ensurePainted, isCurrent, retrigger]);

  const provideInlineCompletions = useCallback(async (
    model: MonacoModel,
    position: GhostPosition,
    _context: unknown,
    token: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } },
  ): Promise<GhostResult> => {
    const opts = optionsRef.current;
    const editorInstance = opts.editorRef.current;
    if (!opts.autocompleteEnabled || !opts.canEdit || opts.inlineEditOpen
      || token.isCancellationRequested || !editorInstance
      || editorInstance.getModel() !== model) {
      return EMPTY_RESULT;
    }
    const selection = editorInstance.getSelection();
    if (selection && !selection.isEmpty()) return EMPTY_RESULT;

    const offset = model.getOffsetAt(position);
    const fullSource = model.getValue();
    const allowed = opts.isMarkdown
      ? !scanMarkdownContext(fullSource, offset).inProtected
        && markdownLineIsProse(fullSource.slice(fullSource.lastIndexOf('\n', offset - 1) + 1, offset))
      : (() => {
        const ctx = scanContext(fullSource, offset);
        return ctx.isInDocument && !ctx.isInPreamble && !ctx.isInMath && !ctx.isInVerbatim
          && !ctx.isInComment && !ctx.isInCommandName && !ctx.isInCommandArg;
      })();
    if (!allowed) {
      readyGhostRef.current = null;
      // The caret moved into protected syntax while a suggestion was still
      // shown: drop the stale ready chip so it cannot claim "Tab to accept".
      if (chipPhaseRef.current === 'ready') applyChip('idle', false);
      return EMPTY_RESULT;
    }

    const key = ghostStreamKey(model.uri.toString(), offset, fullSource.slice(Math.max(0, offset - 40), offset));

    // Word-accept parked the remainder at the caret: re-offer it in place,
    // no refetch, no debounce.
    const ready = readyGhostRef.current;
    if (ready && ready.uri === model.uri.toString()
      && offset === ready.startOffset && chipPhaseRef.current === 'ready') {
      return ghostAt(position, ready.text);
    }

    // A finished request for this exact context: hand back the final text so
    // re-triggers (or a cancelled earlier attempt) still show it.
    const inflight = inflightRef.current;
    if (inflight && inflight.key === key && inflight.terminal) {
      return inflight.finalText ? ghostAt(position, inflight.finalText) : EMPTY_RESULT;
    }

    // Join a debounce or fetch already running for this context: Monaco's
    // request lifecycle is volatile (it cancels tokens freely), so the one
    // promise we hold open gets resolved exactly once when the request
    // settles. That is what actually paints the ghost.
    if (inflight && inflight.key === key) {
      return new Promise<GhostResult>((resolve) => {
        inflight.resolvers.push(resolve);
      });
    }
    if (pendingKeyRef.current === key && debounceTimerRef.current) {
      return new Promise<GhostResult>((resolve) => {
        pendingResolversRef.current.push(resolve);
      });
    }

    // A new context invalidates any prior request/preview. Arming is
    // last-writer-wins: Monaco calls us again for every intermediate caret
    // while typing, so the timer captures the latest context instead of the
    // older requestIds cancelling each other.
    clearPendingDebounce();
    abortInflight();
    if (ready && ready.uri === model.uri.toString() && offset > ready.startOffset) {
      const remainder = consumeGhostByTyping(ready.text, fullSource.slice(ready.startOffset, offset));
      if (remainder !== null && remainder !== '') {
        readyGhostRef.current = { ...ready, startOffset: offset, text: remainder };
        if (chipPhaseRef.current !== 'ready') applyChip('ready', false);
        return ghostAt(position, remainder);
      }
      // Fully typed through or mismatched: drop it and (re)request below.
      readyGhostRef.current = null;
    } else if (ready) {
      readyGhostRef.current = null;
    }

    pendingKeyRef.current = key;
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const waiting = pendingResolversRef.current.splice(0);
      const deliver = (result: GhostResult) => { for (const resolve of waiting) resolve(result); };
      const live = optionsRef.current;
      // Monaco often cancels the token while we debounce (its request model
      // differs from ours); that must not cancel the fetch — every apply
      // path re-validates caret/model/request below and via isCurrent.
      if (!live.autocompleteEnabled || live.inlineEditOpen || !live.canEdit) {
        deliver(EMPTY_RESULT);
        return;
      }
      const currentModel = editorInstance.getModel();
      const caret = editorInstance.getPosition();
      if (!currentModel || currentModel !== model
        || caret?.lineNumber !== position.lineNumber || caret?.column !== position.column) {
        deliver(EMPTY_RESULT);
        return;
      }
      pendingKeyRef.current = null;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      void runRequest(requestId, model, position, key);
      // runRequest registers the inflight synchronously before its first await.
      const started = inflightRef.current;
      if (started && started.requestId === requestId && !started.terminal) {
        started.resolvers.push(...waiting);
      } else {
        deliver(started?.finalText ? ghostAt(position, started.finalText) : EMPTY_RESULT);
      }
    }, GHOST_TEXT_DEBOUNCE_MS);

    return new Promise<GhostResult>((resolve) => {
      pendingResolversRef.current.push(resolve);
    });
  }, [abortInflight, applyChip, clearPendingDebounce, runRequest]);

  const provider = useMemo<languages.InlineCompletionsProvider>(() => ({
    provideInlineCompletions: provideInlineCompletions as unknown as languages.InlineCompletionsProvider['provideInlineCompletions'],

    // Monaco calls this after a native word-accept (Cmd/Ctrl+Right) inserted
    // the first word; mirror the remainder so later typing still matches it.
    handlePartialAccept: (_completions, _item, acceptedCharacters) => {
      const ghost = readyGhostRef.current;
      if (!ghost) return;
      const acceptedLength = Math.max(acceptedCharacters, 0);
      if (acceptedLength >= ghost.text.length) {
        readyGhostRef.current = null;
        return;
      }
      readyGhostRef.current = {
        ...ghost,
        startOffset: ghost.startOffset + acceptedLength,
        text: ghost.text.slice(acceptedLength),
      };
    },

    // End of life. Accepted: the text went in through Monaco's own edit
    // pipeline, so undo and dirty tracking are native. Rejected: Escape —
    // zero bytes changed. Ignored (Monaco dropped the ghost): only reset when
    // the caret has actually left the parked suggestion, because our own
    // word-accept edit makes Monaco retire the previous ghost first.
    handleEndOfLifetime: (_completions, _item, reason) => {
      const kind = (reason as { kind?: number }).kind;
      if (kind === 0) {
        readyGhostRef.current = null;
        applyChip('accepted', true);
      } else if (kind === 1) {
        readyGhostRef.current = null;
        applyChip('idle', false);
        setAnnouncement(GHOST_DISMISSED_ANNOUNCEMENT);
      } else if (kind === 2 && readyGhostRef.current) {
        const editorInstance = optionsRef.current.editorRef.current;
        const model = editorInstance?.getModel();
        const caret = editorInstance?.getPosition();
        const ghost = readyGhostRef.current;
        const stillParked = !!editorInstance && !!model && !!caret
          && ghost.uri === model.uri.toString()
          && model.getOffsetAt(caret) === ghost.startOffset;
        if (!stillParked) {
          readyGhostRef.current = null;
          applyChip('idle', false);
        }
      }
    },

    // Older Monaco runtimes (the CDN build this editor loads) expose only the
    // deprecated rejection hook; wire it defensively as the Escape signal.
    handleRejection: () => {
      if (!readyGhostRef.current) return;
      readyGhostRef.current = null;
      applyChip('idle', false);
      setAnnouncement(GHOST_DISMISSED_ANNOUNCEMENT);
    },

    disposeInlineCompletions: () => {},
  }), [applyChip, provideInlineCompletions]);

  const accept = useCallback(() => {
    const editorInstance = optionsRef.current.editorRef.current;
    if (!editorInstance) return;
    const commit = editorInstance.getAction('editor.action.inlineSuggest.commit');
    if (commit && chipPhaseRef.current === 'ready') {
      commit.run().catch(() => { /* Monaco rejects when the suggestion died mid-click */ });
      return;
    }
    // Manual fallback when the runtime lacks the commit command: insert the
    // visible suggestion as one undoable Monaco edit at the recorded caret.
    const ghost = readyGhostRef.current;
    const model = editorInstance.getModel();
    if (!ghost || !model || ghost.uri !== model.uri.toString()) return;
    const caret = editorInstance.getPosition();
    if (!caret || model.getOffsetAt(caret) !== ghost.startOffset) return;
    editorInstance.pushUndoStop();
    editorInstance.executeEdits('ghost-text-accept', [{
      range: {
        startLineNumber: caret.lineNumber, endLineNumber: caret.lineNumber,
        startColumn: caret.column, endColumn: caret.column,
      },
      text: ghost.text,
      forceMoveMarkers: true,
    }]);
    editorInstance.pushUndoStop();
    readyGhostRef.current = null;
    applyChip('accepted', true);
  }, [applyChip]);

  const retry = useCallback(() => {
    optionsRef.current.onNotice(null);
    applyChip('idle', false);
    const editorInstance = optionsRef.current.editorRef.current;
    if (editorInstance?.getAction('editor.action.inlineSuggest.trigger')) {
      editorInstance.focus();
      editorInstance.trigger('ghost-chip-retry', 'editor.action.inlineSuggest.trigger', { explicit: true });
    }
  }, [applyChip]);

  /**
   * Cmd/Ctrl+Right with a visible suggestion: insert exactly one word as one
   * undoable Monaco edit and keep the remainder visible. Monaco's native
   * acceptNextWord is not used for the custom provider path because it does
   * not re-offer the remainder to a provider-owned completion and accepts a
   * lone leading space before the first real word of a continuation.
   */
  const acceptGhostWord = useCallback(() => {
    const editorInstance = optionsRef.current.editorRef.current;
    const ghost = readyGhostRef.current;
    if (!editorInstance || !ghost) return;
    const model = editorInstance.getModel();
    if (!model || ghost.uri !== model.uri.toString()) {
      readyGhostRef.current = null;
      return;
    }
    const caret = editorInstance.getPosition();
    if (!caret || model.getOffsetAt(caret) !== ghost.startOffset) {
      readyGhostRef.current = null;
      applyChip('idle', false);
      return;
    }
    const { accepted, remainder } = nextGhostWord(ghost.text);
    if (accepted === '') {
      readyGhostRef.current = null;
      applyChip('idle', false);
      return;
    }
    editorInstance.executeEdits('ghost-text-word', [{
      range: {
        startLineNumber: caret.lineNumber, endLineNumber: caret.lineNumber,
        startColumn: caret.column, endColumn: caret.column,
      },
      text: accepted,
      forceMoveMarkers: true,
    }]);
    if (remainder === '') {
      readyGhostRef.current = null;
      applyChip('accepted', true);
      return;
    }
    readyGhostRef.current = { uri: ghost.uri, startOffset: ghost.startOffset + accepted.length, text: remainder };
    retrigger();
  }, [applyChip, retrigger]);

  // Keyboard contract on the Monaco DOM node (the capture pattern that keeps
  // Ctrl/Cmd+K from fighting the browser): while a suggestion is visible,
  // Tab accepts all, Cmd/Ctrl+Right accepts one word, and Escape dismisses —
  // each claimed only in that state. With no suggestion the listener never
  // preventDefaults, so Tab indents, Ctrl/Cmd+Right moves by word, and Escape
  // keeps its app behavior. Alt/Option+Right is deliberately not claimed
  // (Monaco word movement on macOS, browser back elsewhere).
  const keyHandlersRef = useRef({ accept, acceptGhostWord });
  keyHandlersRef.current = { accept, acceptGhostWord };
  useEffect(() => {
    const node = optionsRef.current.editorRef.current?.getDomNode();
    if (!node) return;
    const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !readyGhostRef.current) return;
      const { accept: acceptAll, acceptGhostWord: acceptWord } = keyHandlersRef.current;
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        acceptAll();
        return;
      }
      if (event.key === 'ArrowRight' && !event.altKey && !event.shiftKey
        && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        acceptWord();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const editorInstance = optionsRef.current.editorRef.current;
        void editorInstance?.getAction('editor.action.inlineSuggest.hide')?.run().catch(() => {});
        readyGhostRef.current = null;
        applyChip('idle', false);
        setAnnouncement(GHOST_DISMISSED_ANNOUNCEMENT);
      }
    };
    node.addEventListener('keydown', onKeyDown, true);
    return () => node.removeEventListener('keydown', onKeyDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-attach only when the Monaco instance itself mounts; everything else flows through refs
  }, [options.editorRevision]);

  // Monaco's own automatic trigger policy (snoozing, accept-flow state) is
  // not reliable across editor sessions in this standalone build, so every
  // content or caret change explicitly re-asks the provider after a short
  // settle window. The plan's 450 ms debounce stays inside the provider —
  // this only guarantees the provider is actually consulted.
  useEffect(() => {
    const editorInstance = optionsRef.current.editorRef.current;
    if (!editorInstance) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const live = optionsRef.current;
        const ed = live.editorRef.current;
        if (!ed || !live.autocompleteEnabled || !live.canEdit || live.inlineEditOpen) return;
        if (!ed.hasTextFocus() || ed.getSelection()?.isEmpty() === false) return;
        ed.trigger('ghost-text-kick', 'editor.action.inlineSuggest.trigger', { explicit: true });
      }, 90);
    };
    const contentListener = editorInstance.onDidChangeModelContent(kick);
    const caretListener = editorInstance.onDidChangeCursorPosition(kick);
    return () => {
      if (timer) clearTimeout(timer);
      contentListener.dispose();
      caretListener.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- same lifecycle as the key handler: per Monaco instance
  }, [options.editorRevision]);

  return { provider, chipPhase, modelName, announcement, accept, retry, cancel };
}
