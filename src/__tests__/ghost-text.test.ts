import { describe, expect, it } from 'vitest';
import {
  completionNoticeForStatus,
  consumeGhostByTyping,
  encodeCompleteEvent,
  GHOST_DISMISSED_ANNOUNCEMENT,
  GHOST_TEXT_DEBOUNCE_MS,
  GHOST_TEXT_MAX_INSERTION,
  GHOST_TEXT_STREAM_MAX_CHARS,
  ghostAnnouncement,
  ghostChipView,
  ghostEligibilityReason,
  ghostStreamKey,
  isRetryableCompletionStatus,
  nextGhostWord,
  readCompleteStream,
  shouldShowGhostChip,
  type CompleteStreamEvent,
} from '@/src/lib/ghost-text';
import { splitGhostWord } from '@/src/hooks/useGhostText';
import { stubCompletion, stubCompletionChunks } from '@/src/lib/ai-dev-stub';

const enc = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array> | null): Promise<CompleteStreamEvent[]> {
  const events: CompleteStreamEvent[] = [];
  for await (const event of readCompleteStream(body)) events.push(event);
  return events;
}

describe('ghost text timing and caps', () => {
  it('adopts the 450 ms reference pause and the existing insertion caps', () => {
    expect(GHOST_TEXT_DEBOUNCE_MS).toBe(450);
    expect(GHOST_TEXT_MAX_INSERTION).toBe(200);
    expect(GHOST_TEXT_STREAM_MAX_CHARS).toBeGreaterThanOrEqual(GHOST_TEXT_MAX_INSERTION);
  });
});

describe('ghostEligibilityReason', () => {
  it('allows suggestions only for an enabled, writable, selection-free, idle editor', () => {
    expect(ghostEligibilityReason({ enabled: true, canEdit: true, hasSelection: false, inlineEditOpen: false })).toBeNull();
  });
  it('names each honest suppression reason', () => {
    expect(ghostEligibilityReason({ enabled: false, canEdit: true, hasSelection: false, inlineEditOpen: false })).toContain('off');
    expect(ghostEligibilityReason({ enabled: true, canEdit: false, hasSelection: false, inlineEditOpen: false })).toContain('edit access');
    expect(ghostEligibilityReason({ enabled: true, canEdit: true, hasSelection: true, inlineEditOpen: false })).toContain('selection');
    expect(ghostEligibilityReason({ enabled: true, canEdit: true, hasSelection: false, inlineEditOpen: true })).toContain('inline edit');
  });
});

describe('shouldShowGhostChip (toolbar visibility)', () => {
  it('shows the chip only for a writable, enabled, text editor', () => {
    expect(shouldShowGhostChip({ canEdit: true, autocompleteEnabled: true, isBinaryActive: false })).toBe(true);
  });

  it('hides every autocomplete affordance from a read-only reader', () => {
    expect(shouldShowGhostChip({ canEdit: false, autocompleteEnabled: true, isBinaryActive: false })).toBe(false);
  });

  it('hides the chip when the preference is off or a binary asset is active', () => {
    expect(shouldShowGhostChip({ canEdit: true, autocompleteEnabled: false, isBinaryActive: false })).toBe(false);
    expect(shouldShowGhostChip({ canEdit: true, autocompleteEnabled: true, isBinaryActive: true })).toBe(false);
  });
});

describe('nextGhostWord (word acceptance)', () => {
  it('takes the leading word plus the spaces around it and keeps the remainder visible', () => {
    const split = nextGhostWord(' and the same pattern held');
    expect(split.accepted).toBe(' and ');
    expect(split.remainder).toBe('the same pattern held');
  });
  it('takes leading punctuation with the previous word run', () => {
    const split = nextGhostWord(', which we verified later');
    expect(split.accepted).toBe(', ');
    expect(split.remainder).toBe('which we verified later');
  });
  it('takes leading whitespace up to the next word', () => {
    const split = nextGhostWord('  quick brown fox');
    expect(split.accepted).toBe('  quick ');
    expect(split.remainder).toBe('brown fox');
  });
  it('accepts the whole suggestion when it is a single word', () => {
    const split = nextGhostWord('pattern');
    expect(split.accepted).toBe('pattern');
    expect(split.remainder).toBe('');
  });
  it('treats LaTeX prose the same way through the hook export', () => {
    const split = splitGhostWord(' as shown in table 3');
    expect(split.accepted).toBe(' as ');
    expect(split.remainder).toBe('shown in table 3');
  });
});

describe('consumeGhostByTyping (matching typed characters)', () => {
  it('trims the ghost locally for a matching prefix without a refetch', () => {
    expect(consumeGhostByTyping(' across the next set', ' across')).toBe(' the next set');
  });
  it('returns an empty remainder when the typed text equals the suggestion', () => {
    expect(consumeGhostByTyping('next', 'next')).toBe('');
  });
  it('returns null on a mismatch so the caller can clear and re-debounce', () => {
    expect(consumeGhostByTyping(' the next set', ' the other')).toBeNull();
  });
  it('keeps the whole suggestion when nothing was typed', () => {
    expect(consumeGhostByTyping('whole ghost', '')).toBe('whole ghost');
  });
});

describe('ghostChipView (status chip text labels, never colour alone)', () => {
  it('shows the real reported model name when idle, not a hard-coded label', () => {
    expect(ghostChipView('idle', 'openrouter · openai/gpt-4o-mini').label).toBe('openrouter · openai/gpt-4o-mini');
    expect(ghostChipView('idle', null).label).toBe('AI complete');
  });
  it('cycles Thinking, Tab to accept, Accepted, and No suggestion per the reference', () => {
    expect(ghostChipView('thinking', 'm').label).toBe('Thinking…');
    expect(ghostChipView('ready', 'm').label).toBe('Tab to accept');
    expect(ghostChipView('accepted', 'm').label).toBe('Accepted');
    expect(ghostChipView('none', 'm').label).toBe('No suggestion');
  });
  it('offers tap-to-accept only while a suggestion is visible and Retry only after a retryable failure', () => {
    expect(ghostChipView('ready', 'm').acceptable).toBe(true);
    expect(ghostChipView('idle', 'm').acceptable).toBe(false);
    expect(ghostChipView('unavailable', 'm').retryable).toBe(true);
    expect(ghostChipView('none', 'm').retryable).toBe(false);
    expect(ghostChipView('thinking', 'm').retryable).toBe(false);
  });
});

describe('ghostAnnouncement (polite status region)', () => {
  it('announces the ready suggestion with both keyboard accepts', () => {
    const text = ghostAnnouncement('ready') ?? '';
    expect(text).toContain('Tab');
    expect(text).toContain('Right');
  });
  it('announces accepted, dismissed, none, and unavailable states', () => {
    expect(ghostAnnouncement('accepted')).toContain('accepted');
    expect(GHOST_DISMISSED_ANNOUNCEMENT).toContain('dismissed');
    expect(ghostAnnouncement('none')).toContain('no suggestion');
    expect(ghostAnnouncement('unavailable')).toContain('retry');
  });
  it('does not announce idle or transitions without meaning', () => {
    expect(ghostAnnouncement('idle')).toBeNull();
  });
});

describe('retryable failure classification', () => {
  it('classifies rate limits, server failures, and network loss as retryable', () => {
    expect(isRetryableCompletionStatus(429)).toBe(true);
    expect(isRetryableCompletionStatus(502)).toBe(true);
    expect(isRetryableCompletionStatus(503)).toBe(true);
    expect(isRetryableCompletionStatus(504)).toBe(true);
    expect(isRetryableCompletionStatus(0)).toBe(true);
  });
  it('keeps ordinary no-suggestion answers non-retryable', () => {
    expect(isRetryableCompletionStatus(200)).toBe(false);
    expect(isRetryableCompletionStatus(400)).toBe(false);
    expect(isRetryableCompletionStatus(404)).toBe(false);
  });
  it('maps statuses to honest notices', () => {
    expect(completionNoticeForStatus(429)).toContain('rate limit');
    expect(completionNoticeForStatus(503)).toContain('unavailable');
  });
});

describe('/api/ai/complete NDJSON protocol', () => {
  it('writes one JSON event per line and round-trips every kind', () => {
    const line = encodeCompleteEvent({ type: 'done', insertion: 'a\nb', provider: 'openrouter', model: 'openai/gpt-4o-mini' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line).insertion).toBe('a\nb');
  });

  it('reads events across chunk and multibyte boundaries', async () => {
    const full =
      encodeCompleteEvent({ type: 'delta', text: 'café ' }) +
      encodeCompleteEvent({ type: 'delta', text: 'holder' }) +
      encodeCompleteEvent({ type: 'done', insertion: 'café holder', provider: 'dev-stub', model: 'dev-stub (no provider)' });
    const bytes = enc.encode(full);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 5) chunks.push(new TextDecoder().decode(bytes.slice(i, i + 5)));
    // Naive splitting can cut a multibyte character; the reader buffers bytes.
    const events = await collect(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
        controller.close();
      },
    }));
    void chunks;
    expect(events).toEqual([
      { type: 'delta', text: 'café ' },
      { type: 'delta', text: 'holder' },
      { type: 'done', insertion: 'café holder', provider: 'dev-stub', model: 'dev-stub (no provider)' },
    ]);
  });

  it('ends with a protocol error on a malformed line instead of hanging', async () => {
    const events = await collect(streamOf(['{not json}\n']));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('reports a protocol error for a missing body', async () => {
    const events = await collect(null);
    expect(events).toEqual([{ type: 'error', code: 'protocol', message: 'AI service returned no stream' }]);
  });

  it('accepts null insertions on done (no suggestion is not an error)', async () => {
    const events = await collect(streamOf([
      encodeCompleteEvent({ type: 'done', insertion: null, provider: 'openrouter', model: 'm' }),
    ]));
    expect(events[0]).toMatchObject({ type: 'done', insertion: null });
  });

  it('rejects done events without provider/model identity', async () => {
    const events = await collect(streamOf(['{"type":"done","insertion":"x"}\n']));
    expect(events[0]?.type).toBe('error');
  });
});

describe('ghostStreamKey', () => {
  it('identifies the caret context by the trailing 40 chars so identical tails attach', () => {
    // A shared tail of at least 40 chars is the same continuation context, so
    // a re-trigger attaches instead of refetching even though the earlier
    // prefix text differs.
    const tail = 'the quick brown fox jumps over the lazy dog again and again';
    const a = ghostStreamKey('file:///doc.md', 42, 'x'.repeat(60) + tail);
    expect(a).toBe(ghostStreamKey('file:///doc.md', 42, 'y'.repeat(60) + tail));
    // Any change to offset, uri, or the trailing context means a different key.
    expect(a).not.toBe(ghostStreamKey('file:///doc.md', 43, 'x'.repeat(60) + tail));
    expect(a).not.toBe(ghostStreamKey('file:///other.md', 42, 'x'.repeat(60) + tail));
    expect(a).not.toBe(ghostStreamKey('file:///doc.md', 42, 'z'.repeat(60) + 'a completely different ending here indeed'));
  });
});

describe('stubCompletionChunks', () => {
  it('joins back to the exact single-response completion', () => {
    const prefix = 'We measured the value';
    expect(stubCompletionChunks(prefix).join('')).toBe(stubCompletion(prefix));
  });
  it('streams nothing for the documented no-suggestion triggers', () => {
    expect(stubCompletionChunks('after the timeout')).toEqual([]);
    expect(stubCompletionChunks('result none')).toEqual([]);
  });
  it('groups words so several chunks arrive per suggestion', () => {
    const chunks = stubCompletionChunks('we observed that', 3);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
  });
});
