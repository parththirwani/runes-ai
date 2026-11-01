// Inline edit state machine — pure transitions for the editor-scoped AI edit flow.
// No React, no Monaco, no side effects. The controller in DocumentEditor owns the
// timers and aborts; this module owns only the shape of a legal sequence.

import type { InlineEditAnchor } from './inline-edit-selection';

// -------------------------------------------------------------------------
// Phases
// -------------------------------------------------------------------------

export type InlineEditPhase = 'idle' | 'prompt' | 'requesting' | 'review' | 'error';

export type InlineEditState =
  | { phase: 'idle' }
  | { phase: 'prompt'; anchor: InlineEditAnchor }
  | { phase: 'requesting'; anchor: InlineEditAnchor; requestId: number }
  | { phase: 'review'; anchor: InlineEditAnchor; requestId: number; replacementText: string }
  | { phase: 'error'; anchor: InlineEditAnchor | null; message: string };

export const INITIAL_INLINE_EDIT_STATE: InlineEditState = { phase: 'idle' };

// -------------------------------------------------------------------------
// Events
// -------------------------------------------------------------------------

export type InlineEditEvent =
  /** Selection (or sentence fallback) became an eligible anchor: show the prompt. */
  | { type: 'open'; anchor: InlineEditAnchor }
  /** Prompt submitted: the controller issues the request with this id. */
  | { type: 'submit'; requestId: number }
  /** Provider result for the active request. Late or foreign ids are ignored. */
  | { type: 'result'; requestId: number; replacementText: string }
  /** Request or validation failure. Without a requestId it applies to any. */
  | { type: 'failure'; requestId?: number; message: string }
  /** User pressed Stop while requesting: discard (partial review is a later step). */
  | { type: 'stop' }
  /** Honest refusal of a trigger attempt (ineligible selection, read-only). */
  | { type: 'notice'; message: string }
  /** Error acknowledged. */
  | { type: 'closeError' }
  /** Error with a remembered anchor goes straight back to the prompt. */
  | { type: 'retry' }
  /** Approved replacement was committed to the model: one undoable edit happened. */
  | { type: 'applied' }
  /** Escape / reject-all / navigation: leave without touching the source. */
  | { type: 'dismiss' }
  /** File switch, document switch, read-only toggle, unmount: cancel everything. */
  | { type: 'contextChanged' };

/**
 * Only one proposal is ever active, so `open` replaces whatever was on screen
 * (the controller aborts the discarded request). Terminal decisions return to
 * `idle`; nothing here mutates the model — applying is the controller's job
 * after it rechecks the anchor.
 */
export function inlineEditReducer(state: InlineEditState, event: InlineEditEvent): InlineEditState {
  switch (event.type) {
    case 'open':
      return { phase: 'prompt', anchor: event.anchor };

    case 'submit':
      if (state.phase !== 'prompt') return state;
      return { phase: 'requesting', anchor: state.anchor, requestId: event.requestId };

    case 'result':
      // A late or mismatched response must never open a review.
      if (state.phase !== 'requesting' || state.requestId !== event.requestId) return state;
      return { phase: 'review', anchor: state.anchor, requestId: event.requestId, replacementText: event.replacementText };

    case 'failure':
      if (state.phase === 'requesting') {
        if (event.requestId !== undefined && event.requestId !== state.requestId) return state;
        return { phase: 'error', anchor: state.anchor, message: event.message };
      }
      if (state.phase === 'prompt') return { phase: 'error', anchor: state.anchor, message: event.message };
      return state;

    case 'stop':
      if (state.phase !== 'requesting') return state;
      return { phase: 'idle' };

    case 'notice':
      // A refused trigger only explains itself while nothing else is open: an
      // in-flight request or an open review must never be replaced by a toast.
      if (state.phase !== 'idle') return state;
      return { phase: 'error', anchor: null, message: event.message };

    case 'closeError':
      if (state.phase !== 'error') return state;
      return { phase: 'idle' };

    case 'retry':
      if (state.phase !== 'error' || !state.anchor) return state;
      return { phase: 'prompt', anchor: state.anchor };

    case 'applied':
      if (state.phase !== 'review') return state;
      return { phase: 'idle' };

    case 'dismiss':
      if (state.phase === 'idle' || state.phase === 'requesting') return state;
      return { phase: 'idle' };

    case 'contextChanged':
      return { phase: 'idle' };
  }
}

/** True when the transition abandons an in-flight request the controller must abort. */
export function shouldAbortRequest(prev: InlineEditState, next: InlineEditState): boolean {
  if (prev.phase !== 'requesting') return false;
  return next.phase !== 'requesting' || next.requestId !== prev.requestId;
}

/** True while the ghost text provider must stay silent. */
export function suppressesGhostText(state: InlineEditState): boolean {
  return state.phase === 'prompt' || state.phase === 'requesting' || state.phase === 'review';
}

// -------------------------------------------------------------------------
// Entry gate
// -------------------------------------------------------------------------

export type InlineEditGate = { allowed: true } | { allowed: false; reason: string };

/**
 * Honest preconditions for opening the prompt at all. Eligibility of the text
 * itself is decided by the format analyzers / sentence scanner, which report
 * their own reasons; the server repeats every one of these checks.
 */
export function gateInlineEdit(context: {
  canEdit: boolean;
  isBinaryActive: boolean;
  providerConfigured?: boolean;
}): InlineEditGate {
  if (!context.canEdit) return { allowed: false, reason: 'This document is read-only — AI edits are unavailable' };
  if (context.isBinaryActive) return { allowed: false, reason: 'Binary file cannot be edited' };
  if (context.providerConfigured === false) return { allowed: false, reason: 'AI provider is not configured' };
  return { allowed: true };
}

// -------------------------------------------------------------------------
// Anchor staleness (apply-time recheck, pure)
// -------------------------------------------------------------------------

export type AnchorSnapshot = {
  documentId: string;
  path: string;
  modelUri: string;
  modelVersion: number;
  /** Current model text at the anchor range, or null when the range is unreadable. */
  textAtRange: string | null;
};

/**
 * Reason the anchor may no longer be applied, or null when it is still exact.
 * Mirrors proposal-engine.checkStale but keyed to the file identity as well,
 * because an inline edit must never land in another file of the workspace.
 */
export function anchorStaleReason(anchor: InlineEditAnchor, current: AnchorSnapshot): string | null {
  if (anchor.documentId !== current.documentId) return 'Document changed';
  if (anchor.path !== current.path || anchor.modelUri !== current.modelUri) return 'The file changed while the edit was open';
  if (current.textAtRange === null) return 'The selection range is no longer valid';
  if (current.textAtRange !== anchor.originalText) return 'Selection text has been modified';
  if (anchor.modelVersion !== current.modelVersion) {
    return 'Document was edited elsewhere — the edit was invalidated';
  }
  return null;
}
