import { describe, expect, it } from 'vitest';
import {
  INITIAL_INLINE_EDIT_STATE,
  anchorStaleReason,
  gateInlineEdit,
  inlineEditReducer,
  shouldAbortRequest,
  suppressesGhostText,
} from '@/src/lib/inline-edit-state';
import type { InlineEditAnchor } from '@/src/lib/inline-edit-selection';
import type { InlineEditState } from '@/src/lib/inline-edit-state';

const anchor: InlineEditAnchor = {
  documentId: 'doc-1',
  path: 'main.tex',
  modelUri: 'inmemory://model/1',
  modelVersion: 7,
  startOffset: 10,
  endOffset: 21,
  originalText: 'Some old prose.',
  format: 'latex',
};
const otherAnchor: InlineEditAnchor = { ...anchor, path: 'intro.md', format: 'markdown' };

const promptState: InlineEditState = { phase: 'prompt', anchor };
const requestingState: InlineEditState = { phase: 'requesting', anchor, requestId: 4 };
const reviewState: InlineEditState = { phase: 'review', anchor, requestId: 4, replacementText: 'Some new prose.' };
const errorState: InlineEditState = { phase: 'error', anchor, message: 'AI service error' };

describe('inline edit state machine', () => {
  it('opens the prompt from idle and submits into requesting', () => {
    const opened = inlineEditReducer(INITIAL_INLINE_EDIT_STATE, { type: 'open', anchor });
    expect(opened).toEqual(promptState);
    expect(inlineEditReducer(opened, { type: 'submit', requestId: 4 })).toEqual(requestingState);
  });

  it('ignores submit outside the prompt phase', () => {
    expect(inlineEditReducer(INITIAL_INLINE_EDIT_STATE, { type: 'submit', requestId: 1 })).toEqual(INITIAL_INLINE_EDIT_STATE);
    expect(inlineEditReducer(requestingState, { type: 'submit', requestId: 9 })).toEqual(requestingState);
    expect(inlineEditReducer(reviewState, { type: 'submit', requestId: 9 })).toEqual(reviewState);
  });

  it('shows review only for the request id that is currently active', () => {
    const review = inlineEditReducer(requestingState, { type: 'result', requestId: 4, replacementText: 'Some new prose.' });
    expect(review).toEqual(reviewState);
    // A late response for an older request never opens a review.
    expect(inlineEditReducer(requestingState, { type: 'result', requestId: 3, replacementText: 'late' })).toEqual(requestingState);
    // Nor does a result after the flow already ended.
    expect(inlineEditReducer(INITIAL_INLINE_EDIT_STATE, { type: 'result', requestId: 4, replacementText: 'x' })).toEqual(INITIAL_INLINE_EDIT_STATE);
  });

  it('routes failures to error and supports retry and close', () => {
    const failed = inlineEditReducer(requestingState, { type: 'failure', requestId: 4, message: 'AI service error' });
    expect(failed).toEqual(errorState);
    // A failure from a stale request id is ignored while the current one runs.
    expect(inlineEditReducer(requestingState, { type: 'failure', requestId: 2, message: 'old' })).toEqual(requestingState);
    expect(inlineEditReducer(errorState, { type: 'retry' })).toEqual(promptState);
    expect(inlineEditReducer(errorState, { type: 'closeError' })).toEqual(INITIAL_INLINE_EDIT_STATE);
    const anchorless: InlineEditState = { phase: 'error', anchor: null, message: 'boom' };
    expect(inlineEditReducer(anchorless, { type: 'retry' })).toEqual(anchorless);
  });

  it('stop cancels a request; dismiss only closes non-requesting phases', () => {
    const stopped = inlineEditReducer(requestingState, { type: 'stop' });
    expect(stopped).toEqual(INITIAL_INLINE_EDIT_STATE);
    expect(inlineEditReducer(requestingState, { type: 'dismiss' })).toEqual(requestingState);
    expect(inlineEditReducer(promptState, { type: 'dismiss' })).toEqual(INITIAL_INLINE_EDIT_STATE);
    expect(inlineEditReducer(reviewState, { type: 'dismiss' })).toEqual(INITIAL_INLINE_EDIT_STATE);
  });

  it('applied only leaves review, and no phase other than review can apply', () => {
    expect(inlineEditReducer(reviewState, { type: 'applied' })).toEqual(INITIAL_INLINE_EDIT_STATE);
    expect(inlineEditReducer(promptState, { type: 'applied' })).toEqual(promptState);
    expect(inlineEditReducer(requestingState, { type: 'applied' })).toEqual(requestingState);
  });

  it('keeps one active proposal: opening a new edit replaces the old flow', () => {
    const opened = inlineEditReducer(reviewState, { type: 'open', anchor: otherAnchor });
    expect(opened).toEqual({ phase: 'prompt', anchor: otherAnchor });
    const fromRequest = inlineEditReducer(requestingState, { type: 'open', anchor: otherAnchor });
    expect(fromRequest).toEqual({ phase: 'prompt', anchor: otherAnchor });
    expect(shouldAbortRequest(requestingState, fromRequest)).toBe(true);
  });

  it('contextChanged returns to idle from every phase and aborts an in-flight request', () => {
    for (const state of [promptState, requestingState, reviewState, errorState]) {
      expect(inlineEditReducer(state, { type: 'contextChanged' })).toEqual(INITIAL_INLINE_EDIT_STATE);
    }
    expect(shouldAbortRequest(requestingState, inlineEditReducer(requestingState, { type: 'contextChanged' }))).toBe(true);
    expect(shouldAbortRequest(requestingState, requestingState)).toBe(false);
    expect(shouldAbortRequest(reviewState, INITIAL_INLINE_EDIT_STATE)).toBe(false);
  });

  it('suppresses ghost text during prompt, request, and review', () => {
    expect(suppressesGhostText(promptState)).toBe(true);
    expect(suppressesGhostText(requestingState)).toBe(true);
    expect(suppressesGhostText(reviewState)).toBe(true);
    expect(suppressesGhostText(INITIAL_INLINE_EDIT_STATE)).toBe(false);
    expect(suppressesGhostText(errorState)).toBe(false);
  });
});

describe('inline edit gate', () => {
  it('refuses read-only and binary contexts with honest reasons', () => {
    expect(gateInlineEdit({ canEdit: false, isBinaryActive: false })).toEqual({
      allowed: false, reason: 'This document is read-only — AI edits are unavailable',
    });
    expect(gateInlineEdit({ canEdit: true, isBinaryActive: true })).toEqual({
      allowed: false, reason: 'Binary file cannot be edited',
    });
    expect(gateInlineEdit({ canEdit: true, isBinaryActive: false, providerConfigured: false })).toEqual({
      allowed: false, reason: 'AI provider is not configured',
    });
    expect(gateInlineEdit({ canEdit: true, isBinaryActive: false, providerConfigured: true })).toEqual({ allowed: true });
  });
});

describe('anchor staleness', () => {
  const fresh = {
    documentId: 'doc-1', path: 'main.tex', modelUri: 'inmemory://model/1',
    modelVersion: 7, textAtRange: 'Some old prose.',
  };

  it('accepts only the exact same file, version, and bytes', () => {
    expect(anchorStaleReason(anchor, fresh)).toBeNull();
  });

  it('refuses after document, file, or range identity changes', () => {
    expect(anchorStaleReason(anchor, { ...fresh, documentId: 'doc-2' })).toBe('Document changed');
    expect(anchorStaleReason(anchor, { ...fresh, path: 'other.tex' })).toBe('The file changed while the edit was open');
    expect(anchorStaleReason(anchor, { ...fresh, modelUri: 'inmemory://model/9' })).toBe('The file changed while the edit was open');
    expect(anchorStaleReason(anchor, { ...fresh, textAtRange: null })).toBe('The selection range is no longer valid');
  });

  it('refuses when the original bytes no longer match or the model moved', () => {
    expect(anchorStaleReason(anchor, { ...fresh, textAtRange: 'Some edited text.' })).toBe('Selection text has been modified');
    // Same bytes but a newer version: edited elsewhere — invalidated to be safe,
    // matching the proposal-engine rule the side panel already uses.
    expect(anchorStaleReason(anchor, { ...fresh, modelVersion: 8 })).toBe('Document was edited elsewhere — the edit was invalidated');
  });
});

describe('refused triggers (notice)', () => {
  it('explains an ineligible trigger while idle, without touching the model', () => {
    const next = inlineEditReducer(INITIAL_INLINE_EDIT_STATE, { type: 'notice', message: 'The selection is not editable prose' });
    expect(next).toEqual({ phase: 'error', anchor: null, message: 'The selection is not editable prose' });
    expect(inlineEditReducer(next, { type: 'closeError' })).toEqual(INITIAL_INLINE_EDIT_STATE);
    // No anchor remembered: a refusal cannot be retried against stale bytes.
    expect(inlineEditReducer(next, { type: 'retry' })).toEqual(next);
  });

  it('never replaces an open prompt, request, or review', () => {
    const notice = { type: 'notice' as const, message: 'ignored' };
    expect(inlineEditReducer(promptState, notice)).toBe(promptState);
    expect(inlineEditReducer(requestingState, notice)).toBe(requestingState);
    expect(inlineEditReducer(reviewState, notice)).toBe(reviewState);
    expect(inlineEditReducer(errorState, notice)).toBe(errorState);
  });

  it('a Stop during a request lands on the honest explanation, not a review', () => {
    let state = inlineEditReducer(requestingState, { type: 'stop' });
    expect(state).toEqual(INITIAL_INLINE_EDIT_STATE);
    state = inlineEditReducer(state, { type: 'notice', message: 'Stopped — the partial edit was discarded' });
    expect(state).toEqual({ phase: 'error', anchor: null, message: 'Stopped — the partial edit was discarded' });
  });
});
