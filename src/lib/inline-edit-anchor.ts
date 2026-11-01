// Inline edit anchor building — pure composition of every guard the editor
// controller needs before it may show a prompt, and the exact anchor record a
// later Apply rechecks. Selection eligibility (analyzers, one-block rule,
// character cap, word boundary) and the deterministic sentence-at-caret
// fallback already live in inline-edit-selection.ts; this module only wires
// them into one decision so the controller stays thin and every refusal
// reason is testable without Monaco or a browser.

import { analyzeSelection, scanContext, selectionCutsWord } from './latex-utils';
import { analyzeMarkdownSelection, scanMarkdownContext } from './markdown-utils';
import {
  containsMultipleProseBlocks,
  findSentenceAtCaret,
  INLINE_EDIT_MAX_CHARS,
  type InlineEditAnchor,
  type InlineEditFormat,
} from './inline-edit-selection';
import { anchorStaleReason, type AnchorSnapshot } from './inline-edit-state';

export type InlineEditTarget = 'selection' | 'caret';

export type InlineEditRange = {
  startOffset: number;
  endOffset: number;
  text: string;
  /** How the range was found: a real selection or the sentence fallback. */
  via: InlineEditTarget;
};

export type RangeEvaluation = { ok: true; range: InlineEditRange } | { ok: false; reason: string };

export const INLINE_EDIT_NO_SELECTION_REASON = 'Select prose, or put the caret inside a sentence and press the edit shortcut again';
export const INLINE_EDIT_CROSS_BLOCK_REASON = 'Selection spans more than one prose block — edit one block at a time';
export const INLINE_EDIT_WORD_CUT_REASON = 'Select complete words';

function fail(reason: string): RangeEvaluation {
  return { ok: false, reason };
}

/**
 * Eligibility of an actual selection. The same rules the server repeats:
 * non-empty prose, one block, under the character cap, editable by the format
 * analyzer, and never a partial word.
 */
export function evaluateInlineEditRange(input: {
  source: string;
  format: InlineEditFormat;
  selectionStart: number;
  selectionEnd: number;
}): RangeEvaluation {
  const { source, format } = input;
  const start = Math.max(0, Math.min(input.selectionStart, input.selectionEnd));
  const end = Math.min(source.length, Math.max(input.selectionStart, input.selectionEnd));
  if (end <= start) return fail(INLINE_EDIT_NO_SELECTION_REASON);

  const selected = source.slice(start, end);
  if (selected.trim() === '') return fail('The selection has no prose to edit');
  if (selected.length > INLINE_EDIT_MAX_CHARS) {
    return fail(`Selection is longer than the ${INLINE_EDIT_MAX_CHARS} character limit`);
  }
  if (containsMultipleProseBlocks(selected)) return fail(INLINE_EDIT_CROSS_BLOCK_REASON);

  const analysis = format === 'markdown'
    ? analyzeMarkdownSelection(selected, scanMarkdownContext(source, start))
    : analyzeSelection(selected, scanContext(source, start));
  if (!analysis.eligible) return fail(analysis.reason || 'The selection is not editable prose');
  if (selectionCutsWord(source.slice(0, start), selected, source.slice(end))) return fail(INLINE_EDIT_WORD_CUT_REASON);

  return { ok: true, range: { startOffset: start, endOffset: end, text: selected, via: 'selection' } };
}

/** Eligibility of the caret's sentence, used when there is no selection. */
export function evaluateInlineEditCaret(input: {
  source: string;
  format: InlineEditFormat;
  caretOffset: number;
}): RangeEvaluation {
  const found = findSentenceAtCaret(input.source, input.caretOffset, input.format);
  if (!found.eligible) return fail(found.reason);
  return {
    ok: true,
    range: { startOffset: found.startOffset, endOffset: found.endOffset, text: found.text, via: 'caret' },
  };
}

/**
 * What the bubble click and the Ctrl/Cmd+K trigger call: a real selection is
 * used as-is, an empty selection falls back to the sentence around the caret.
 * Either way the refusal reason is honest — there is no whole-line fallback.
 */
export function evaluateInlineEditTarget(input: {
  source: string;
  format: InlineEditFormat;
  selectionStart: number;
  selectionEnd: number;
  caretOffset: number;
}): RangeEvaluation {
  const start = Math.min(input.selectionStart, input.selectionEnd);
  const end = Math.max(input.selectionStart, input.selectionEnd);
  if (end > start) {
    return evaluateInlineEditRange({ source: input.source, format: input.format, selectionStart: start, selectionEnd: end });
  }
  return evaluateInlineEditCaret({ source: input.source, format: input.format, caretOffset: input.caretOffset });
}

export type InlineEditModelIdentity = {
  documentId: string;
  path: string;
  modelUri: string;
  modelVersion: number;
  format: InlineEditFormat;
};

/** Freeze the model identity plus the exact original bytes of the range. */
export function buildInlineEditAnchor(model: InlineEditModelIdentity, range: InlineEditRange): InlineEditAnchor {
  return {
    documentId: model.documentId,
    path: model.path,
    modelUri: model.modelUri,
    modelVersion: model.modelVersion,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    originalText: range.text,
    format: model.format,
  };
}

export type InlineEditModelNow = {
  documentId: string;
  path: string;
  modelUri: string;
  modelVersion: number;
  /** Current full text of the model the anchor would be applied to. */
  source: string;
};

/** Read the anchor's bytes out of the live model; null when unreadable. */
export function anchorSnapshotFor(anchor: InlineEditAnchor, current: InlineEditModelNow): AnchorSnapshot {
  const readable =
    anchor.startOffset >= 0 &&
    anchor.endOffset >= anchor.startOffset &&
    anchor.endOffset <= current.source.length;
  return {
    documentId: current.documentId,
    path: current.path,
    modelUri: current.modelUri,
    modelVersion: current.modelVersion,
    textAtRange: readable ? current.source.slice(anchor.startOffset, anchor.endOffset) : null,
  };
}

/**
 * Why this anchor may not be applied right now, or null when it is still exact.
 * Used both to keep an open review inert and as the last check before the one
 * undoable Monaco edit.
 */
export function anchorIsStale(
  anchor: InlineEditAnchor,
  current: InlineEditModelNow,
): string | null {
  return anchorStaleReason(anchor, anchorSnapshotFor(anchor, current));
}
