import { describe, expect, it } from 'vitest';
import {
  assembleReplacement,
  buildInlineEditHunks,
  finalizeInlineEditReplacement,
  verifyProtectedSpansPreserved,
  withAllDecisions,
  withHunkDecision,
} from '@/src/lib/inline-edit-hunks';
import {
  extractProtectedLatexTokens,
  analyzeSelection,
} from '@/src/lib/latex-utils';
import {
  extractProtectedMarkdownTokens,
  analyzeMarkdownSelection,
} from '@/src/lib/markdown-utils';

const decideAll = (model: ReturnType<typeof buildInlineEditHunks>, decision: 'accepted' | 'rejected') =>
  withAllDecisions(model, decision);

describe('buildInlineEditHunks', () => {
  it('produces one hunk for a single word change with exact original offsets', () => {
    const model = buildInlineEditHunks('The quick brown fox.', 'The fast brown fox.');
    expect(model.hunks).toHaveLength(1);
    const hunk = model.hunks[0];
    expect(hunk.originalText).toBe('quick');
    expect(hunk.newText).toBe('fast');
    expect(hunk.originalStart).toBe(4);
    expect(hunk.originalEnd).toBe(9);
    expect(model.originalText.slice(hunk.originalStart, hunk.originalEnd)).toBe('quick');
    expect(hunk.decision).toBe('pending');
  });

  it('splits separated changes into independently decidable hunks, in order', () => {
    const model = buildInlineEditHunks(
      'The quick brown fox jumps.',
      'The fast brown cat jumps.',
    );
    expect(model.hunks).toHaveLength(2);
    expect(model.hunks[0].originalText).toBe('quick');
    expect(model.hunks[0].newText).toBe('fast');
    expect(model.hunks[1].originalText).toBe('fox');
    expect(model.hunks[1].newText).toBe('cat');
    expect(model.hunks[1].originalStart).toBeGreaterThan(model.hunks[0].originalEnd);
  });

  it('handles a pure insertion and a pure deletion', () => {
    const insertion = buildInlineEditHunks('two words here.', 'three words here.');
    const removal = buildInlineEditHunks('a stray word here.', 'a here.');
    expect(insertion.hunks.length).toBeGreaterThanOrEqual(1);
    const del = removal.hunks.find((h) => h.newText.replace(/\S/g, '') === h.newText && h.originalText.trim() !== '');
    expect(del).toBeDefined();
  });

  it('returns no hunks for identical text (the route already blocks no-ops)', () => {
    const model = buildInlineEditHunks('Same prose.', 'Same prose.');
    expect(model.hunks).toHaveLength(0);
  });

  it('collapses to a single hunk beyond the computeDiff size cap', () => {
    const original = 'lorem '.repeat(1000);
    const replacement = 'ipsum '.repeat(1000);
    const model = buildInlineEditHunks(original, replacement);
    expect(model.hunks).toHaveLength(1);
    expect(model.hunks[0].originalText).toBe(original);
    expect(model.hunks[0].newText).toBe(replacement);
  });

  it('generates deterministic stable ids for the same inputs', () => {
    const a = buildInlineEditHunks('The quick brown fox jumps.', 'The fast brown cat jumps.');
    const b = buildInlineEditHunks('The quick brown fox jumps.', 'The fast brown cat jumps.');
    expect(a.hunks.map((h) => h.id)).toEqual(b.hunks.map((h) => h.id));
    expect(new Set(a.hunks.map((h) => h.id)).size).toBe(a.hunks.length);
  });
});

describe('decisions and assembly', () => {
  const twoChanges = () =>
    buildInlineEditHunks('The quick brown fox jumps.', 'The fast brown cat jumps.');

  it('blocks assembly while any hunk is undecided', () => {
    const model = twoChanges();
    const half = withHunkDecision(model, model.hunks[0].id, 'accepted');
    expect(half).not.toBeNull();
    const result = assembleReplacement(half!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('1 of 2 changes still need a decision');
  });

  it('returns null for an unknown hunk id and never mutates the model', () => {
    const model = twoChanges();
    expect(withHunkDecision(model, 'hunk-9-0-0', 'accepted')).toBeNull();
    const updated = withHunkDecision(model, model.hunks[0].id, 'rejected');
    expect(model.hunks[0].decision).toBe('pending');
    expect(updated!.hunks[0].decision).toBe('rejected');
  });

  it('Accept all rebuilds the validated replacement exactly', () => {
    const result = assembleReplacement(decideAll(twoChanges(), 'accepted'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('The fast brown cat jumps.');
      expect(result.acceptedCount).toBe(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.changed).toBe(true);
    }
  });

  it('Reject all returns the original bytes with changed=false (zero-byte commit)', () => {
    const result = assembleReplacement(decideAll(twoChanges(), 'rejected'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(twoChanges().originalText);
      expect(result.changed).toBe(false);
    }
  });

  it('mixed decisions: accepted hunks contribute suggested text, rejected keep original bytes', () => {
    const model = twoChanges();
    const mixed = withHunkDecision(
      withHunkDecision(model, model.hunks[0].id, 'accepted')!,
      model.hunks[1].id,
      'rejected',
    )!;
    const result = assembleReplacement(mixed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('The fast brown fox jumps.');
      expect(result.acceptedCount).toBe(1);
      expect(result.rejectedCount).toBe(1);
    }
  });

  it('assembly of zero hunks is the original text unchanged', () => {
    const result = assembleReplacement(buildInlineEditHunks('Nothing changed.', 'Nothing changed.'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Nothing changed.');
      expect(result.changed).toBe(false);
    }
  });
});

describe('verifyProtectedSpansPreserved', () => {
  it('extracts the exact spans analyzeMarkdownSelection masks', () => {
    const text = 'See [the docs](https://example.com/a) and `keep this` plus $x_1$ math.';
    const analysis = analyzeMarkdownSelection(text, {
      isInFrontMatter: false, isInFencedCode: false, isInInlineCode: false, isInMath: false,
      isInLinkDestination: false, isInImageUrl: false, isInRawHtml: false,
      isInTableDelimiter: false, isInHeadingMarker: false, isInListMarker: false,
      isInReferenceDefinition: false, inReferenceTarget: false, inProtected: false,
    });
    expect(analysis.eligible).toBe(true);
    expect(extractProtectedMarkdownTokens(text)).toEqual(
      analysis.protectedTokens.map((t) => t.original),
    );
  });

  it('extracts the exact spans analyzeSelection masks for LaTeX', () => {
    const text = 'As shown in \\cite{smith2020}, the value $E=mc^2$ holds.';
    const analysis = analyzeSelection(text, {
      isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false,
      isInVerbatim: false, isInCommandName: false, isInCommandArg: false,
    });
    expect(analysis.eligible).toBe(true);
    expect(extractProtectedLatexTokens(text)).toEqual(
      analysis.protectedTokens.map((t) => t.original),
    );
  });

  it('passes when assembled text keeps every span byte-for-byte in order', () => {
    const original = 'See [the docs](https://example.com/a) now.';
    const assembled = 'Look at [the docs](https://example.com/a) today.';
    expect(verifyProtectedSpansPreserved(original, assembled, 'markdown').ok).toBe(true);
  });

  it('blocks when a Markdown link or inline code span is missing', () => {
    const original = 'See [the docs](https://example.com/a) and `keep this` now.';
    const broken = 'Look at the docs and keep this now.';
    const check = verifyProtectedSpansPreserved(original, broken, 'markdown');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('Protected Markdown text');
  });

  it('blocks when protected spans are reordered', () => {
    const original = 'First [a](u1) then [b](u2).';
    const swapped = 'First [b](u2) then [a](u1).';
    expect(verifyProtectedSpansPreserved(original, swapped, 'markdown').ok).toBe(false);
  });

  it('blocks when a LaTeX citation/command is dropped or altered', () => {
    const original = 'As shown in \\cite{smith2020}, results follow.';
    expect(verifyProtectedSpansPreserved(original, 'As shown, results follow.', 'latex').ok).toBe(false);
    expect(verifyProtectedSpansPreserved(original, 'As shown in \\cite{smith2021}, results follow.', 'latex').ok).toBe(false);
    expect(verifyProtectedSpansPreserved(original, 'Overall, \\cite{smith2020} results follow.', 'latex').ok).toBe(true);
  });
});

describe('finalizeInlineEditReplacement', () => {
  it('propagates the undecided reason', () => {
    const model = buildInlineEditHunks('a b c d e f.', 'a B c D e f.');
    const result = finalizeInlineEditReplacement(model, 'markdown');
    expect(result.ok).toBe(false);
  });

  it('blocks Apply when a mixed assembly would cut a protected span, explaining why', () => {
    const original = 'as shown in \\cite{a} we observe effects';
    const replacement = 'overall \\cite{a} shows effects';
    const model = buildInlineEditHunks(original, replacement);
    const allAccepted = finalizeInlineEditReplacement(withAllDecisions(model, 'accepted'), 'latex');
    expect(allAccepted.ok).toBe(true);
    const half = withAllDecisions(model, 'accepted');
    const one = withHunkDecision(half, half.hunks[half.hunks.length - 1].id, 'rejected')!;
    const result = finalizeInlineEditReplacement(one, 'latex');
    if (!result.ok) {
      expect(result.reason).toContain('Protected LaTeX text');
    } else {
      // If the diff never split the citation across hunks, mixed decisions must
      // still preserve it byte-for-byte.
      expect(result.text).toContain('\\cite{a}');
    }
  });

  it('allows Apply for prose-only changes with no protected spans', () => {
    const model = buildInlineEditHunks('This sentence is wordy.', 'This sentence is short.');
    const result = finalizeInlineEditReplacement(withAllDecisions(model, 'accepted'), 'markdown');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('This sentence is short.');
  });

  it('Reject-all on a protected-span proposal finalizes as the untouched original', () => {
    const original = 'See [the docs](https://example.com/a) now.';
    const model = buildInlineEditHunks(original, 'Look at [the docs](https://example.com/a) today.');
    const result = finalizeInlineEditReplacement(withAllDecisions(model, 'rejected'), 'markdown');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.text).toBe(original);
    }
  });
});
