// Inline edit review model — pure helpers for the anchored prompt/streaming/
// review UI described in docs/ai-inline-edit-plan.md §"Per-change review" and
// step 4. No React, no Monaco: the components only render what these functions
// return, so every keyboard rule and label is testable on its own.

import { computeDiff, type DiffToken } from './proposal-engine';
import { assembleReplacement, type InlineEditHunkModel } from './inline-edit-hunks';

// -------------------------------------------------------------------------
// Streaming preview
// -------------------------------------------------------------------------

const TRAILING_PARTIAL_WORD = /[\p{L}\p{N}]+$/u;

export type PartialWordHold = { revealed: string; held: string };

/**
 * A streamed tail is usually half a word. Reveal only complete words: the
 * trailing run of letters/digits is held back until whitespace (or the
 * verified final text) arrives, so the preview never flickers a broken word.
 */
export function holdBackPartialWord(text: string): PartialWordHold {
  const match = TRAILING_PARTIAL_WORD.exec(text);
  if (!match) return { revealed: text, held: '' };
  return { revealed: text.slice(0, text.length - match[0].length), held: match[0] };
}

export type StreamingPreview = PartialWordHold & { tokens: DiffToken[] };

/** Word diff of the original selection against the safely revealed prefix. */
export function buildStreamingPreview(original: string, visible: string): StreamingPreview {
  const { revealed, held } = holdBackPartialWord(visible);
  return { revealed, held, tokens: computeDiff(original, revealed) };
}

// -------------------------------------------------------------------------
// Diff grouping (one run of removed/added tokens is one reviewable change)
// -------------------------------------------------------------------------

export type DiffSegment =
  | { kind: 'equal'; text: string }
  | { kind: 'change'; ordinal: number; removed: string; added: string };

/**
 * Ordinals match buildInlineEditHunks because both walk the same computeDiff
 * output in order: every contiguous run of changed tokens is the next change.
 */
export function groupDiffSegments(tokens: DiffToken[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let ordinal = 0;
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === 'equal') {
      segments.push({ kind: 'equal', text: tokens[i].value });
      i += 1;
      continue;
    }
    let removed = '';
    let added = '';
    while (i < tokens.length && tokens[i].type !== 'equal') {
      if (tokens[i].type === 'remove') removed += tokens[i].value;
      else added += tokens[i].value;
      i += 1;
    }
    segments.push({ kind: 'change', ordinal, removed, added });
    ordinal += 1;
  }
  return segments;
}

// -------------------------------------------------------------------------
// Keyboard model (plan step 5): Tab cycles changes, Enter accepts the focused
// change, Backspace rejects it, Ctrl/Cmd+Enter accepts the rest. Escape is the
// controller's dismiss, and unhandled keys keep their normal behaviour.
// -------------------------------------------------------------------------

export type InlineEditKeySignal = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export type InlineEditReviewAction =
  | { type: 'focusNext' }
  | { type: 'focusPrev' }
  | { type: 'acceptFocused' }
  | { type: 'rejectFocused' }
  | { type: 'acceptRest' };

export function reviewActionForKey(signal: InlineEditKeySignal, hasFocusedChange: boolean): InlineEditReviewAction | null {
  const command = signal.ctrlKey === true || signal.metaKey === true;
  switch (signal.key) {
    case 'Tab':
      return signal.shiftKey === true ? { type: 'focusPrev' } : { type: 'focusNext' };
    case 'Enter':
      if (command) return { type: 'acceptRest' };
      return hasFocusedChange && signal.shiftKey !== true ? { type: 'acceptFocused' } : null;
    case 'Backspace':
      return !command && hasFocusedChange ? { type: 'rejectFocused' } : null;
    default:
      return null;
  }
}

/** Roving focus over the change list. Wraps, and never points outside it. */
export function cycleChangeFocus(
  count: number,
  current: number | null,
  direction: 'next' | 'prev' = 'next',
): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return direction === 'next' ? 0 : count - 1;
  return (current + (direction === 'next' ? 1 : count - 1)) % count;
}

// -------------------------------------------------------------------------
// Decision summary (labels, Apply gating, screen-reader announcement)
// -------------------------------------------------------------------------

export type InlineEditReviewSummary = {
  total: number;
  decided: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** "1 of 2 changes" — matches the reference review bar wording. */
  changesLabel: string;
  /** "Applied 2 of 2" — matches the reference receipt wording. */
  appliedLabel: string;
  canApply: boolean;
  /** "Apply", or "Keep original" when every change was rejected (zero bytes). */
  applyLabel: string;
  blockedReason: string | null;
};

export function summarizeReview(model: InlineEditHunkModel): InlineEditReviewSummary {
  const total = model.hunks.length;
  const accepted = model.hunks.filter((h) => h.decision === 'accepted').length;
  const rejected = model.hunks.filter((h) => h.decision === 'rejected').length;
  const pending = total - accepted - rejected;
  const assembled = assembleReplacement(model);
  const keepsOriginal = assembled.ok && !assembled.changed;

  let canApply = false;
  let blockedReason: string | null = null;
  if (total === 0) {
    blockedReason = 'No word-level change to review';
  } else if (!assembled.ok) {
    blockedReason = assembled.reason;
  } else {
    canApply = true;
  }

  return {
    total,
    decided: accepted + rejected,
    accepted,
    rejected,
    pending,
    changesLabel: `${accepted + rejected} of ${total} changes`,
    appliedLabel: `Applied ${accepted} of ${total}`,
    canApply,
    applyLabel: keepsOriginal ? 'Keep original' : 'Apply',
    blockedReason,
  };
}



/** Polite-region text for the current decision state of the review. */
export function reviewAnnouncement(summary: InlineEditReviewSummary): string {
  if (summary.total === 0) return 'No changes to review';
  if (summary.pending > 0) {
    return `${summary.changesLabel} decided, ${summary.pending} still to review`;
  }
  if (summary.accepted === 0) return `All ${summary.total} changes rejected — the original text is kept`;
  if (summary.rejected === 0) return `All ${summary.total} changes accepted — Apply makes one undoable edit`;
  return `${summary.accepted} accepted, ${summary.rejected} rejected — Apply makes one undoable edit`;
}

// -------------------------------------------------------------------------
// Bubble visibility (plan user flow 1: readers see no affordance at all)
// -------------------------------------------------------------------------

export type EditBubbleContext = {
  canEdit: boolean;
  hasSelection: boolean;
  selectionEligible: boolean;
  phase: 'idle' | 'prompt' | 'requesting' | 'review' | 'error';
  isBinaryActive?: boolean;
};

export function shouldShowEditBubble(context: EditBubbleContext): boolean {
  if (!context.canEdit) return false;
  if (context.isBinaryActive) return false;
  if (context.phase !== 'idle') return false;
  return context.hasSelection && context.selectionEligible;
}

/** Honest reason the keyboard trigger cannot open the prompt, or null. */
export function editTriggerBlockReason(context: EditBubbleContext): string | null {
  if (!context.canEdit) return 'This document is read-only — AI edits are unavailable';
  if (context.isBinaryActive) return 'Binary file cannot be edited';
  if (context.phase !== 'idle') return 'Finish or dismiss the current AI edit first';
  if (!context.hasSelection) return 'Select prose, or put the caret inside a sentence and try again';
  if (!context.selectionEligible) return 'The selection is not editable prose';
  return null;
}
