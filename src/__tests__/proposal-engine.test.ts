// Tests for proposal-engine.ts — proposal types, diff, stale detection, acceptance verification

import { describe, it, expect } from 'vitest';
import {
  EditProposal,
  computeDiff,
  checkStale,
  verifyAcceptance,
  generateProposalId,
} from '../lib/proposal-engine';

function makeProposal(overrides: Partial<EditProposal> = {}): EditProposal {
  return {
    id: 'test-1',
    documentId: 'doc-1',
    source: 'paraphrase',
    baseModelVersion: 5,
    range: { startOffset: 100, endOffset: 130 },
    originalText: 'This is the original text.',
    replacementText: 'This is the revised text.',
    state: 'pending',
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('falls back to a full comparison for large selections', () => {
    const original = 'a'.repeat(6_000);
    const replacement = 'b'.repeat(6_000);
    expect(computeDiff(original, replacement)).toEqual([
      { value: original, type: 'remove' },
      { value: replacement, type: 'add' },
    ]);
  });
  it('detects additions', () => {
    const tokens = computeDiff('Hello world.', 'Hello beautiful world.');
    const additions = tokens.filter(t => t.type === 'add');
    expect(additions.length).toBeGreaterThan(0);
    expect(additions.some(t => t.value.includes('beautiful'))).toBe(true);
  });

  it('detects removals', () => {
    const tokens = computeDiff('This is long text.', 'Short text.');
    const removals = tokens.filter(t => t.type === 'remove');
    expect(removals.length).toBeGreaterThan(0);
  });

  it('preserves equal tokens', () => {
    const tokens = computeDiff('Same text', 'Same text');
    expect(tokens.every(t => t.type === 'equal')).toBe(true);
  });

  it('handles whitespace and newlines', () => {
    const tokens = computeDiff('Line one\nLine two', 'Line one\nChanged two');
    const removes = tokens.filter(t => t.type === 'remove');
    // "Line" is removed (replaced by "Changed"), " two" is kept
    expect(removes.some(t => t.value === 'Line')).toBe(true);
  });

  it('handles empty original', () => {
    const tokens = computeDiff('', 'New content');
    expect(tokens.every(t => t.type === 'add')).toBe(true);
  });
});

describe('checkStale', () => {
  it('returns not stale when everything matches', () => {
    const p = makeProposal();
    const result = checkStale(p, 'doc-1', 5, 'This is the original text.');
    expect(result.isStale).toBe(false);
  });

  it('detects document change', () => {
    const p = makeProposal();
    const result = checkStale(p, 'doc-2', 5, 'This is the original text.');
    expect(result.isStale).toBe(true);
    expect(result.reason).toContain('Document');
  });

  it('detects version change with mismatched text', () => {
    const p = makeProposal();
    const result = checkStale(p, 'doc-1', 6, 'Changed text');
    expect(result.isStale).toBe(true);
  });

  it('detects already-stale proposal', () => {
    const p = makeProposal({ state: 'stale' });
    const result = checkStale(p, 'doc-1', 5, 'This is the original text.');
    expect(result.isStale).toBe(true);
  });
});

describe('verifyAcceptance', () => {
  it('allows acceptance of valid pending proposal', () => {
    const p = makeProposal({ range: { startOffset: 0, endOffset: 26 }, originalText: 'This is the original text.' });
    const result = verifyAcceptance(p, 'This is the original text. and more');
    expect(result.applied).toBe(true);
  });

  it('rejects stale proposal', () => {
    const p = makeProposal({ state: 'stale' });
    const result = verifyAcceptance(p, 'anything');
    expect(result.applied).toBe(false);
  });

  it('rejects already accepted proposal', () => {
    const p = makeProposal({ state: 'accepted' });
    const result = verifyAcceptance(p, 'anything');
    expect(result.applied).toBe(false);
  });

  it('rejects when original text no longer matches', () => {
    const p = makeProposal({ range: { startOffset: 0, endOffset: 5 }, originalText: 'Old text' });
    const result = verifyAcceptance(p, 'Completely different content');
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('no longer matches');
  });

  it('rejects when range text differs (user edited selection)', () => {
    const p = makeProposal({ range: { startOffset: 0, endOffset: 5 }, originalText: 'Hello' });
    const result = verifyAcceptance(p, 'World and more');
    expect(result.applied).toBe(false);
  });

  it('rejects malformed ranges, including empty text at a negative offset', () => {
    const negative = makeProposal({ range: { startOffset: -1, endOffset: 0 }, originalText: '' });
    expect(verifyAcceptance(negative, 'document').applied).toBe(false);
    const inverted = makeProposal({ range: { startOffset: 4, endOffset: 2 }, originalText: '' });
    expect(verifyAcceptance(inverted, 'document').applied).toBe(false);
    const pastEnd = makeProposal({ range: { startOffset: 0, endOffset: 99 }, originalText: 'document' });
    expect(verifyAcceptance(pastEnd, 'document').applied).toBe(false);
  });

  it('handles repeated identical text correctly', () => {
    // Two identical sentences; proposal targets the second one
    const doc = 'This is text. This is text.';
    // "This is text." = 13 chars. First: 0-13, second: 14-27
    const p = makeProposal({
      range: { startOffset: 14, endOffset: 27 },
      originalText: 'This is text.',
      replacementText: 'This is revised.',
    });
    const result = verifyAcceptance(p, doc);
    expect(result.applied).toBe(true);
  });
});

describe('generateProposalId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateProposalId());
    }
    expect(ids.size).toBe(100);
  });
});
