import { describe, expect, it } from 'vitest';
import {
  buildStreamingPreview,
  cycleChangeFocus,
  editTriggerBlockReason,
  groupDiffSegments,
  holdBackPartialWord,
  reviewActionForKey,
  reviewAnnouncement,
  shouldShowEditBubble,
  summarizeReview,
} from '@/src/lib/inline-edit-review';
import { buildInlineEditHunks, withAllDecisions, withHunkDecision } from '@/src/lib/inline-edit-hunks';
import { computeDiff } from '@/src/lib/proposal-engine';

const TWO_CHANGES = 'The quick brown fox jumps.';
const TWO_NEW = 'The fast brown cat jumps.';

describe('holdBackPartialWord', () => {
  it('holds only the trailing word fragment', () => {
    expect(holdBackPartialWord('The quick br')).toEqual({ revealed: 'The quick ', held: 'br' });
    expect(holdBackPartialWord('The quick ')).toEqual({ revealed: 'The quick ', held: '' });
    expect(holdBackPartialWord('Rewritten,')).toEqual({ revealed: 'Rewritten,', held: '' });
    expect(holdBackPartialWord('')).toEqual({ revealed: '', held: '' });
  });

  it('holds nothing but the word when the stream has one fragment only', () => {
    expect(holdBackPartialWord('Replac')).toEqual({ revealed: '', held: 'Replac' });
  });

  it('treats accented letters as word characters', () => {
    expect(holdBackPartialWord('café cr')).toEqual({ revealed: 'café ', held: 'cr' });
  });
});

describe('buildStreamingPreview', () => {
  it('diffs the original selection against the revealed words only', () => {
    const preview = buildStreamingPreview('The quick brown fox.', 'The fast brown fo');
    expect(preview.revealed).toBe('The fast brown ');
    expect(preview.held).toBe('fo');
    expect(preview.tokens.some((token) => token.type === 'add' && token.value.includes('fast'))).toBe(true);
    expect(preview.tokens.some((token) => token.type === 'add' && token.value.includes('fo'))).toBe(false);
  });

  it('produces no additions for an empty preview', () => {
    const preview = buildStreamingPreview('Some prose.', '');
    expect(preview.revealed).toBe('');
    expect(preview.tokens.filter((token) => token.type === 'add')).toHaveLength(0);
  });
});

describe('groupDiffSegments', () => {
  it('numbers change runs exactly like the hunk builder', () => {
    const tokens = computeDiff(TWO_CHANGES, TWO_NEW);
    const hunks = buildInlineEditHunks(TWO_CHANGES, TWO_NEW).hunks;
    const changes = groupDiffSegments(tokens).filter((segment) => segment.kind === 'change');
    expect(changes).toHaveLength(hunks.length);
    changes.forEach((segment, index) => {
      expect(segment.kind).toBe('change');
      if (segment.kind !== 'change') return;
      expect(segment.ordinal).toBe(index);
      expect(segment.removed).toBe(hunks[index].originalText);
      expect(segment.added).toBe(hunks[index].newText);
    });
  });

  it('keeps equal text as its own segment and nothing for empty input', () => {
    const segments = groupDiffSegments(computeDiff('alpha beta', 'alpha gamma'));
    expect(segments.map((segment) => segment.kind)).toEqual(['equal', 'change']);
    expect(groupDiffSegments([])).toEqual([]);
  });
});

describe('reviewActionForKey', () => {
  it('maps the plan keyboard model onto review actions', () => {
    expect(reviewActionForKey({ key: 'Tab' }, true)).toBeNull();
    expect(reviewActionForKey({ key: 'Tab', shiftKey: true }, true)).toBeNull();
    expect(reviewActionForKey({ key: 'Enter' }, true)).toBeNull();
    expect(reviewActionForKey({ key: 'Backspace' }, true)).toEqual({ type: 'rejectFocused' });
    expect(reviewActionForKey({ key: 'Enter', ctrlKey: true }, true)).toEqual({ type: 'apply' });
    expect(reviewActionForKey({ key: 'Enter', metaKey: true }, false)).toEqual({ type: 'apply' });
  });

  it('leaves unhandled keys and undirected accept/reject to the editor', () => {
    expect(reviewActionForKey({ key: 'Escape' }, true)).toBeNull();
    expect(reviewActionForKey({ key: 'a' }, true)).toBeNull();
    expect(reviewActionForKey({ key: 'Enter' }, false)).toBeNull();
    expect(reviewActionForKey({ key: 'Backspace' }, false)).toBeNull();
    expect(reviewActionForKey({ key: 'Backspace', ctrlKey: true }, true)).toBeNull();
  });
});

describe('cycleChangeFocus', () => {
  it('walks the change list and wraps in both directions', () => {
    expect(cycleChangeFocus(3, null, 'next')).toBe(0);
    expect(cycleChangeFocus(3, null, 'prev')).toBe(2);
    expect(cycleChangeFocus(3, 1, 'next')).toBe(2);
    expect(cycleChangeFocus(3, 2, 'next')).toBe(0);
    expect(cycleChangeFocus(3, 0, 'prev')).toBe(2);
  });

  it('recovers from an out-of-range index and stays null with no changes', () => {
    expect(cycleChangeFocus(2, 9, 'next')).toBe(0);
    expect(cycleChangeFocus(2, -1, 'prev')).toBe(1);
    expect(cycleChangeFocus(0, null, 'next')).toBeNull();
  });
});

describe('summarizeReview', () => {
  it('blocks Apply while any change still needs a decision', () => {
    const model = buildInlineEditHunks(TWO_CHANGES, TWO_NEW);
    const summary = summarizeReview(model);
    expect(summary.total).toBe(2);
    expect(summary.pending).toBe(2);
    expect(summary.canApply).toBe(false);
    expect(summary.blockedReason).toContain('need a decision');
    expect(summary.changesLabel).toBe('0 of 2 changes');
  });

  it('counts a partial decision set', () => {
    const model = withHunkDecision(buildInlineEditHunks(TWO_CHANGES, TWO_NEW), 'hunk-0-4-5', 'accepted');
    expect(model).not.toBeNull();
    const summary = summarizeReview(model!);
    expect(summary.accepted).toBe(1);
    expect(summary.decided).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.canApply).toBe(false);
  });

  it('enables Apply after Accept all and offers Keep original after Reject all', () => {
    const accepted = summarizeReview(withAllDecisions(buildInlineEditHunks(TWO_CHANGES, TWO_NEW), 'accepted'));
    expect(accepted.canApply).toBe(true);
    expect(accepted.applyLabel).toBe('Apply');
    expect(accepted.appliedLabel).toBe('Applied 2 of 2');

    const rejected = summarizeReview(withAllDecisions(buildInlineEditHunks(TWO_CHANGES, TWO_NEW), 'rejected'));
    expect(rejected.canApply).toBe(true);
    expect(rejected.applyLabel).toBe('Keep original');
    expect(rejected.rejected).toBe(2);
  });

  it('reports a replacement with no word-level change instead of an empty Apply', () => {
    const summary = summarizeReview(buildInlineEditHunks('Same text.', 'Same text.'));
    expect(summary.total).toBe(0);
    expect(summary.canApply).toBe(false);
    expect(summary.blockedReason).toBe('No word-level change to review');
  });
});

describe('reviewAnnouncement', () => {
  it('describes pending, all-rejected and mixed states in words', () => {
    expect(reviewAnnouncement(summarizeReview(buildInlineEditHunks(TWO_CHANGES, TWO_NEW))))
      .toBe('0 of 2 changes decided, 2 still to review');
    expect(reviewAnnouncement(summarizeReview(withAllDecisions(buildInlineEditHunks(TWO_CHANGES, TWO_NEW), 'rejected'))))
      .toContain('rejected');
    const mixed = withHunkDecision(
      withAllDecisions(buildInlineEditHunks(TWO_CHANGES, TWO_NEW), 'rejected'),
      'hunk-0-4-5',
      'accepted',
    );
    expect(reviewAnnouncement(summarizeReview(mixed!))).toContain('1 selected, 1 original');
  });
});

describe('edit bubble visibility and honest refusal', () => {
  const base = { canEdit: true, hasSelection: true, selectionEligible: true, phase: 'idle' as const };

  it('shows the bubble only for an eligible selection in a writable file at rest', () => {
    expect(shouldShowEditBubble(base)).toBe(true);
    expect(shouldShowEditBubble({ ...base, phase: 'review' })).toBe(false);
    expect(shouldShowEditBubble({ ...base, selectionEligible: false })).toBe(false);
    expect(shouldShowEditBubble({ ...base, hasSelection: false })).toBe(false);
  });

  it('gives readers no affordance at all and says why the shortcut did nothing', () => {
    expect(shouldShowEditBubble({ ...base, canEdit: false })).toBe(false);
    expect(shouldShowEditBubble({ ...base, isBinaryActive: true })).toBe(false);
    expect(editTriggerBlockReason({ ...base, canEdit: false })).toContain('read-only');
    expect(editTriggerBlockReason({ ...base, isBinaryActive: true })).toContain('Binary');
    expect(editTriggerBlockReason({ ...base, phase: 'requesting' })).toContain('current AI edit');
    expect(editTriggerBlockReason({ ...base, hasSelection: false })).toContain('caret');
    expect(editTriggerBlockReason({ ...base, selectionEligible: false })).toContain('not editable prose');
    expect(editTriggerBlockReason(base)).toBeNull();
  });
});
