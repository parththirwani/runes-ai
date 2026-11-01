import { describe, expect, it } from 'vitest';
import {
  INLINE_EDIT_CROSS_BLOCK_REASON,
  INLINE_EDIT_NO_SELECTION_REASON,
  INLINE_EDIT_WORD_CUT_REASON,
  anchorIsStale,
  anchorSnapshotFor,
  buildInlineEditAnchor,
  evaluateInlineEditCaret,
  evaluateInlineEditRange,
  evaluateInlineEditTarget,
} from '@/src/lib/inline-edit-anchor';
import { INLINE_EDIT_MAX_CHARS, type InlineEditAnchor } from '@/src/lib/inline-edit-selection';

const MD = [
  '---',
  'title: Notes',
  '---',
  '',
  '# Methods',
  '',
  'We collected samples daily. The team used `pytest` for every run.',
  'See [the protocol](https://example.test/p) for the full procedure.',
  '',
  'A second paragraph stands alone.',
].join('\n');

const mdOffset = (needle: string) => MD.indexOf(needle);

const TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  '',
  '\\section{Intro}',
  'The results were measured twice per day.',
  'Later work cites \\cite{smith2020} for the baseline.',
  '',
  '\\end{document}',
].join('\n');

const texOffset = (needle: string) => TEX.indexOf(needle);

describe('inline edit range eligibility', () => {
  it('accepts a markdown prose selection with exact offsets and bytes', () => {
    const start = mdOffset('We collected samples daily.');
    const result = evaluateInlineEditRange({
      source: MD, format: 'markdown', selectionStart: start, selectionEnd: start + 'We collected samples daily.'.length,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range).toEqual({
      startOffset: start,
      endOffset: start + 'We collected samples daily.'.length,
      text: 'We collected samples daily.',
      via: 'selection',
    });
  });

  it('normalizes a backward selection', () => {
    const start = mdOffset('We collected');
    const end = start + 'We collected'.length;
    const result = evaluateInlineEditRange({ source: MD, format: 'markdown', selectionStart: end, selectionEnd: start });
    expect(result.ok && result.range.startOffset).toBe(start);
    expect(result.ok && result.range.endOffset).toBe(end);
  });

  it('refuses an empty selection with the caret-fallback hint', () => {
    const start = mdOffset('We collected');
    expect(evaluateInlineEditRange({ source: MD, format: 'markdown', selectionStart: start, selectionEnd: start }))
      .toEqual({ ok: false, reason: INLINE_EDIT_NO_SELECTION_REASON });
  });

  it('refuses whitespace-only, cross-block, oversized and partial-word selections', () => {
    const blank = MD.indexOf('\n\n');
    expect(evaluateInlineEditRange({ source: MD, format: 'markdown', selectionStart: blank, selectionEnd: blank + 2 }))
      .toEqual({ ok: false, reason: 'The selection has no prose to edit' });

    const crossStart = mdOffset('A second paragraph');
    expect(evaluateInlineEditRange({
      source: MD, format: 'markdown', selectionStart: mdOffset('daily.'), selectionEnd: crossStart + 5,
    })).toEqual({ ok: false, reason: INLINE_EDIT_CROSS_BLOCK_REASON });

    const long = 'Word. '.repeat(2000);
    expect(evaluateInlineEditRange({ source: long, format: 'markdown', selectionStart: 0, selectionEnd: long.length }))
      .toEqual({ ok: false, reason: `Selection is longer than the ${INLINE_EDIT_MAX_CHARS} character limit` });

    const wordStart = mdOffset('collected');
    expect(evaluateInlineEditRange({ source: MD, format: 'markdown', selectionStart: wordStart, selectionEnd: wordStart + 4 }))
      .toEqual({ ok: false, reason: INLINE_EDIT_WORD_CUT_REASON });
  });

  it('refuses a selection that is nothing but protected markdown syntax', () => {
    const codeStart = mdOffset('`pytest`');
    expect(evaluateInlineEditRange({
      source: MD, format: 'markdown', selectionStart: codeStart, selectionEnd: codeStart + '`pytest`'.length,
    })).toEqual({ ok: false, reason: 'Select prose as well as Markdown tokens' });

    const linkStart = mdOffset('[the protocol](https://example.test/p)');
    const link = evaluateInlineEditRange({
      source: MD, format: 'markdown', selectionStart: linkStart, selectionEnd: linkStart + '[the protocol](https://example.test/p)'.length,
    });
    expect(link.ok).toBe(false);

    // Prose next to the protected span stays editable, with the span inside it.
    const withProse = evaluateInlineEditRange({
      source: MD, format: 'markdown',
      selectionStart: mdOffset('The team used'),
      selectionEnd: codeStart + '`pytest`'.length,
    });
    expect(withProse.ok).toBe(true);
  });

  it('accepts latex prose and refuses command-only and preamble selections', () => {
    const start = texOffset('The results were measured twice per day.');
    const ok = evaluateInlineEditRange({
      source: TEX, format: 'latex', selectionStart: start, selectionEnd: start + 'The results were measured twice per day.'.length,
    });
    expect(ok.ok).toBe(true);

    const citeStart = texOffset('\\cite{smith2020}');
    expect(evaluateInlineEditRange({
      source: TEX, format: 'latex', selectionStart: citeStart, selectionEnd: citeStart + '\\cite{smith2020}'.length,
    })).toEqual({ ok: false, reason: 'Select prose as well as LaTeX tokens' });

    const preamble = evaluateInlineEditRange({
      source: TEX, format: 'latex', selectionStart: texOffset('article}'), selectionEnd: texOffset('article}') + 6,
    });
    expect(preamble.ok).toBe(false);
  });
});

describe('inline edit caret fallback and target dispatch', () => {
  it('finds the sentence around the caret when nothing is selected', () => {
    const caret = mdOffset('team used') + 3;
    const result = evaluateInlineEditCaret({ source: MD, format: 'markdown', caretOffset: caret });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.via).toBe('caret');
    expect(result.range.text).toBe('The team used `pytest` for every run.');
  });

  it('refuses a caret that sits on structural or protected text', () => {
    expect(evaluateInlineEditCaret({ source: MD, format: 'markdown', caretOffset: mdOffset('# Methods') + 3 }).ok).toBe(false);
    expect(evaluateInlineEditCaret({ source: MD, format: 'markdown', caretOffset: mdOffset('title: Notes') + 2 }).ok).toBe(false);
    expect(evaluateInlineEditCaret({ source: TEX, format: 'latex', caretOffset: texOffset('smith2020') + 2 }).ok).toBe(false);
  });

  it('prefers the selection and only falls back to the caret when it is empty', () => {
    const selected = mdOffset('We collected samples daily.');
    const withSelection = evaluateInlineEditTarget({
      source: MD, format: 'markdown', selectionStart: selected, selectionEnd: selected + 'We collected samples'.length, caretOffset: selected + 'We collected samples'.length,
    });
    expect(withSelection.ok && withSelection.range.via).toBe('selection');

    const caret = mdOffset('paragraph stands') + 2;
    const withoutSelection = evaluateInlineEditTarget({
      source: MD, format: 'markdown', selectionStart: caret, selectionEnd: caret, caretOffset: caret,
    });
    expect(withoutSelection.ok && withoutSelection.range.via).toBe('caret');
  });
});

describe('inline edit anchor identity and staleness', () => {
  const start = mdOffset('We collected samples daily.');
  const range = { startOffset: start, endOffset: start + 'We collected samples daily.'.length, text: 'We collected samples daily.', via: 'selection' as const };
  const anchor: InlineEditAnchor = buildInlineEditAnchor(
    { documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, format: 'markdown' },
    range,
  );

  it('freezes the model identity with the exact original bytes', () => {
    expect(anchor).toEqual({
      documentId: 'doc-1',
      path: 'notes.md',
      modelUri: 'file:///notes.md',
      modelVersion: 7,
      startOffset: start,
      endOffset: range.endOffset,
      originalText: 'We collected samples daily.',
      format: 'markdown',
    });
  });

  it('reads the anchor bytes back out of the live model', () => {
    const snapshot = anchorSnapshotFor(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: MD,
    });
    expect(snapshot.textAtRange).toBe('We collected samples daily.');
    expect(anchorIsStale(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: MD,
    })).toBeNull();
  });

  it('refuses to apply after any model change, even when the bytes repeat elsewhere', () => {
    const edited = MD + '\n\nWe collected samples daily.';
    expect(anchorIsStale(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 8, source: MD,
    })).toBe('Document was edited elsewhere — the edit was invalidated');

    const bytesChanged = MD.replace('We collected samples daily.', 'We collected samples hourly.');
    expect(anchorIsStale(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: bytesChanged,
    })).toBe('Selection text has been modified');

    expect(anchorIsStale(anchor, {
      documentId: 'doc-1', path: 'other.md', modelUri: 'file:///other.md', modelVersion: 7, source: edited,
    })).toBe('The file changed while the edit was open');

    expect(anchorIsStale(anchor, {
      documentId: 'doc-2', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: MD,
    })).toBe('Document changed');
  });

  it('reports an unreadable range instead of guessing', () => {
    const truncated = MD.slice(0, range.endOffset - 3);
    const snapshot = anchorSnapshotFor(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: truncated,
    });
    expect(snapshot.textAtRange).toBeNull();
    expect(anchorIsStale(anchor, {
      documentId: 'doc-1', path: 'notes.md', modelUri: 'file:///notes.md', modelVersion: 7, source: truncated,
    })).toBe('The selection range is no longer valid');
  });
});
