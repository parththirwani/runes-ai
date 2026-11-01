// Inline edit selection helpers — pure, deterministic helpers shared by the
// editor controller and the /api/ai/inline-edit route. No React, no Monaco.

import { analyzeSelection, scanContext, selectionCutsWord, PLACEHOLDER_PREFIX } from './latex-utils';
import { analyzeMarkdownSelection, markdownLineIsProse, scanMarkdownContext } from './markdown-utils';

export type InlineEditFormat = 'markdown' | 'latex';

/** Everything needed to apply an edit later and to prove it is still exact. */
export type InlineEditAnchor = {
  documentId: string;
  /** Active workspace-relative path. */
  path: string;
  /** Monaco model URI identity. */
  modelUri: string;
  modelVersion: number;
  startOffset: number;
  endOffset: number;
  originalText: string;
  format: InlineEditFormat;
};

export const INLINE_EDIT_MAX_CHARS = 10_000;
export const INLINE_EDIT_MAX_INSTRUCTION_CHARS = 500;

// -------------------------------------------------------------------------
// Quick actions — ids and labels for the client, instructions server-owned.
// -------------------------------------------------------------------------

export const INLINE_EDIT_QUICK_ACTION_IDS = ['shorter', 'clearer', 'formal', 'fix-grammar'] as const;
export type InlineEditQuickActionId = (typeof INLINE_EDIT_QUICK_ACTION_IDS)[number];

export const INLINE_EDIT_QUICK_ACTION_LABELS: Record<InlineEditQuickActionId, string> = {
  shorter: 'Shorter',
  clearer: 'Clearer',
  formal: 'Formal',
  'fix-grammar': 'Fix grammar',
};

export const INLINE_EDIT_QUICK_ACTION_INSTRUCTIONS: Record<InlineEditQuickActionId, string> = {
  shorter: 'Make the selected text more concise and shorter while preserving its meaning.',
  clearer: 'Make the selected text clearer and more readable while preserving its meaning.',
  formal: 'Make the selected text more formal and academic in tone while preserving its meaning.',
  'fix-grammar': 'Correct the grammar, spelling, and punctuation of the selected text without changing its meaning.',
};

export function isInlineEditQuickActionId(value: unknown): value is InlineEditQuickActionId {
  return typeof value === 'string' && (INLINE_EDIT_QUICK_ACTION_IDS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------
// Free instruction validation (also enforced server-side)
// -------------------------------------------------------------------------

export type InstructionValidation =
  | { ok: true; instruction: string }
  | { ok: false; reason: string };

/**
 * A free instruction can only ever be prose appended inside a fixed prompt
 * whose rules section always follows it. These checks keep it short, single
 * line, and unable to forge the placeholder syntax or the prompt delimiters.
 */
export function validateFreeInstruction(input: unknown): InstructionValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'Instruction must be text' };
  const instruction = input.trim();
  if (!instruction) return { ok: false, reason: 'Instruction is empty' };
  if (instruction.length > INLINE_EDIT_MAX_INSTRUCTION_CHARS) {
    return { ok: false, reason: `Instruction is limited to ${INLINE_EDIT_MAX_INSTRUCTION_CHARS} characters` };
  }
  if (/[\u0000-\u001f\u007f]/.test(instruction)) return { ok: false, reason: 'Instruction contains control characters' };
  if (instruction.includes('"""')) return { ok: false, reason: 'Instruction cannot contain the quote delimiter' };
  if (instruction.includes(PLACEHOLDER_PREFIX)) return { ok: false, reason: 'Instruction cannot contain protected placeholder syntax' };
  if (/ignore\s+(all\s+|the\s+)?(previous|prior|above|system)\s+(rules|instructions)/i.test(instruction)) {
    return { ok: false, reason: 'Instruction cannot ask to drop the document rules' };
  }
  return { ok: true, instruction };
}

// -------------------------------------------------------------------------
// Block boundary checks
// -------------------------------------------------------------------------

/**
 * True when the selection contains a blank line between two non-empty lines:
 * that is prose from more than one block, and one edit may not span blocks.
 */
export function containsMultipleProseBlocks(selectedText: string): boolean {
  const lines = selectedText.split(/\r?\n/);
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return false;
  for (let i = first + 1; i < last; i++) {
    if (lines[i].trim() === '') return true;
  }
  return false;
}

// -------------------------------------------------------------------------
// Sentence at caret (Ctrl/Cmd+K with no selection)
// -------------------------------------------------------------------------

export type SentenceResult =
  | { eligible: true; startOffset: number; endOffset: number; text: string }
  | { eligible: false; reason: string };

const MD_LINE_STRUCTURAL = /^\s{0,3}(#{1,6}(\s|$)|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\||\[[^\]]+\]:)/;
const TEX_LINE_COMMAND = /^\s*\\/;
const TEX_LINE_COMMENT = /^\s*%/;
const SENTENCE_CLOSERS = new Set(['"', "'", '\u2019', '\u201d', ')', ']']);
const ABBREVIATION_BEFORE_DOT = /(?:^|[\s(["'\u2018\u201c])(?:dr|mr|mrs|ms|prof|sr|jr|st|vs|etc|approx|fig|eq|vol|nos|al|e\.g|i\.e)$/i;
const CAPITAL_INITIAL_BEFORE_DOT = /(?:^|\s)[A-Z]$/;

type LineSpan = { text: string; start: number; end: number };

function lineSpans(source: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      const endRaw = i > start && source[i - 1] === '\r' ? i - 1 : i;
      spans.push({ text: source.slice(start, endRaw), start, end: endRaw });
      start = i + 1;
    }
  }
  return spans;
}

function indexOfLine(spans: LineSpan[], offset: number): number {
  for (let i = 0; i < spans.length; i++) {
    if (offset <= spans[i].end) return i;
  }
  return spans.length - 1;
}

/** Exclusive offset just past a sentence terminator at `i`, or null. */
function sentenceEndAt(text: string, i: number): number | null {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?') return null;
  let j = i + 1;
  while (j < text.length && SENTENCE_CLOSERS.has(text[j])) j++;
  if (j < text.length && !/\s/.test(text[j])) return null;
  if (ch === '.') {
    const before = text.slice(0, i);
    if (ABBREVIATION_BEFORE_DOT.test(before)) return null;
    if (CAPITAL_INITIAL_BEFORE_DOT.test(before)) return null;
  }
  let k = j;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (k < text.length && /\p{Ll}/u.test(text[k])) return null;
  return j;
}

function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const end = sentenceEndAt(text, i);
    if (end !== null) {
      if (ends.length === 0 || ends[ends.length - 1] <= i) ends.push(end);
      else if (end > ends[ends.length - 1]) ends[ends.length - 1] = end;
      i = end - 1;
    }
  }
  return ends;
}

function fail(reason: string): SentenceResult { return { eligible: false, reason }; }

/**
 * Deterministic prose scanner for the no-selection Ctrl/Cmd+K path: find the
 * sentence around the caret inside exactly one prose block. The found range is
 * re-validated with the same format analyzers the edit path uses, so the
 * scanner can never smuggle protected syntax past the guards. It never
 * returns a whole line, paragraph, or file as a fallback — when no eligible
 * sentence exists, it reports why.
 */
export function findSentenceAtCaret(source: string, offset: number, format: InlineEditFormat): SentenceResult {
  if (!source || offset < 0 || offset > source.length) return fail('Caret is outside the document');
  const spans = lineSpans(source);
  const lineIndex = indexOfLine(spans, offset);
  const caretLine = spans[lineIndex];
  const caretLineEmpty = caretLine.text.trim() === '';

  let segmentLines: LineSpan[];
  if (format === 'markdown') {
    const caretContext = scanMarkdownContext(source, offset);
    if (caretContext.inProtected) return fail(markdownProtectedReason(caretContext));
    if (caretLineEmpty) return fail('No eligible sentence around the caret');
    if (!markdownLineIsProse(caretLine.text) || MD_LINE_STRUCTURAL.test(caretLine.text)) {
      return fail('Caret is not on a prose line');
    }
    let top = lineIndex;
    let bottom = lineIndex;
    const separable = (i: number) =>
      spans[i].text.trim() === '' || MD_LINE_STRUCTURAL.test(spans[i].text) || !markdownLineIsProse(spans[i].text);
    while (top > 0 && !separable(top - 1)) top--;
    while (bottom < spans.length - 1 && !separable(bottom + 1)) bottom++;
    segmentLines = spans.slice(top, bottom + 1);
  } else {
    const caretContext = scanContext(source, offset);
    if (!caretContext.isInDocument) return fail('Caret is outside the document body');
    if (caretContext.isInComment) return fail('Caret is inside a LaTeX comment');
    if (caretContext.isInMath) return fail('Caret is inside math mode');
    if (caretContext.isInVerbatim) return fail('Caret is inside a verbatim environment');
    if (caretContext.isInCommandName || caretContext.isInCommandArg) return fail('Caret is inside a LaTeX command');
    if (TEX_LINE_COMMENT.test(caretLine.text)) return fail('Caret is inside a LaTeX comment');
    if (TEX_LINE_COMMAND.test(caretLine.text)) return fail('Caret is on a LaTeX command line');
    let top = lineIndex;
    let bottom = lineIndex;
    const separable = (i: number) =>
      spans[i].text.trim() === '' || TEX_LINE_COMMAND.test(spans[i].text) || TEX_LINE_COMMENT.test(spans[i].text);
    while (top > 0 && !separable(top - 1)) top--;
    while (bottom < spans.length - 1 && !separable(bottom + 1)) bottom++;
    segmentLines = spans.slice(top, bottom + 1);
  }

  const segmentText = segmentLines.map((line) => line.text).join('\n');
  const segmentStart = segmentLines[0].start;
  const caretInSegment = Math.max(0, Math.min(offset - segmentStart, segmentText.length));

  const ends = sentenceEnds(segmentText);
  let from = 0;
  for (const end of ends) {
    if (end <= caretInSegment) from = end;
    else break;
  }
  let to = segmentText.length;
  for (const end of ends) {
    if (end > from) { to = end; break; }
  }
  while (from < to && /\s/.test(segmentText[from])) from++;
  while (to > from && /\s/.test(segmentText[to - 1])) to--;

  const text = segmentText.slice(from, to);
  if (!text.trim()) return fail('No eligible sentence around the caret');
  if (text.length > INLINE_EDIT_MAX_CHARS) return fail('Sentence exceeds the selection limit');

  const startOffset = segmentStart + from;
  const endOffset = segmentStart + to;

  const analysis = format === 'markdown'
    ? analyzeMarkdownSelection(text, scanMarkdownContext(source, startOffset))
    : analyzeSelection(text, scanContext(source, startOffset));
  if (!analysis.eligible) return fail(analysis.reason || 'The sentence around the caret is not editable prose');
  if (selectionCutsWord(source.slice(0, startOffset), text, source.slice(endOffset))) {
    return fail('The sentence boundary cuts a word');
  }

  return { eligible: true, startOffset, endOffset, text };
}

function markdownProtectedReason(context: ReturnType<typeof scanMarkdownContext>): string {
  if (context.isInFrontMatter) return 'Caret is inside YAML front matter';
  if (context.isInFencedCode) return 'Caret is inside a fenced code block';
  if (context.isInInlineCode) return 'Caret is inside inline code';
  if (context.isInMath) return 'Caret is inside math';
  if (context.isInLinkDestination || context.isInImageUrl || context.inReferenceTarget) return 'Caret is inside a link or image';
  if (context.isInRawHtml) return 'Caret is inside raw HTML';
  return 'Caret is inside protected Markdown syntax';
}

// -------------------------------------------------------------------------
// Anchored placement
// -------------------------------------------------------------------------

export type AnchoredRect = { top: number; bottom: number; left: number };
export type ContainerSize = { width: number; height: number };
export type CardSize = { width: number; height: number };

/**
 * Place a bubble or review card at a Monaco selection rectangle and keep it
 * fully inside the editor. Prefers below the anchor (reference behavior),
 * flips above when it would not fit, then clamps both axes so the card stays
 * reachable after every scroll or resize.
 */
export function positionAnchoredCard(
  anchor: AnchoredRect,
  container: ContainerSize,
  card: CardSize,
  opts?: { gap?: number; margin?: number },
): { top: number; left: number; placed: 'below' | 'above' } {
  const gap = opts?.gap ?? 8;
  const margin = opts?.margin ?? 8;

  const maxLeft = Math.max(margin, container.width - card.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);

  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - card.height;
  const fitsBelow = belowTop + card.height <= container.height - margin;
  const fitsAbove = aboveTop >= margin;

  let placed: 'below' | 'above';
  let top: number;
  if (fitsBelow || !fitsAbove) {
    placed = 'below';
    top = belowTop;
  } else {
    placed = 'above';
    top = aboveTop;
  }
  const maxTop = Math.max(margin, container.height - card.height - margin);
  top = Math.min(Math.max(top, margin), maxTop);
  return { top, left, placed };
}
