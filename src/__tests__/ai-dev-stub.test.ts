import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_DEV_STUB_MODEL,
  aiDevStubDelayMs,
  aiDevStubEnabled,
  stubCompletion,
  stubInlineEditChunks,
  stubInlineEditReply,
  stubKeepsPlaceholders,
  stubProviderResponse,
  stubStreamResponse,
} from '@/src/lib/ai-dev-stub';
import { parseProviderSseLine } from '@/src/lib/inline-edit-stream';
import { filterCompletion } from '@/src/lib/latex-utils';
import { filterMarkdownCompletion } from '@/src/lib/markdown-utils';

const CONCISE = 'Make the selected text more concise and shorter while preserving its meaning.';
const GRAMMAR = 'Correct the grammar, spelling, and punctuation of the selected text without changing its meaning.';
const FORMAL = 'Make the selected text more formal and academic in tone while preserving its meaning.';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dev stub gating', () => {
  it('answers only in a development server with the explicit flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AI_DEV_STUB', '1');
    expect(aiDevStubEnabled()).toBe(true);
    vi.stubEnv('AI_DEV_STUB', '0');
    expect(aiDevStubEnabled()).toBe(false);
    delete process.env.AI_DEV_STUB;
    expect(aiDevStubEnabled()).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AI_DEV_STUB', '1');
    expect(aiDevStubEnabled()).toBe(false);
    vi.stubEnv('NODE_ENV', 'test');
    expect(aiDevStubEnabled()).toBe(false);
  });

  it('reports a model name that cannot be mistaken for a real provider', () => {
    expect(AI_DEV_STUB_MODEL).toContain('dev-stub');
  });
});

describe('deterministic inline edit replies', () => {
  const masked = 'The value is @@PROTECTED_0__ and it links to @@PROTECTED_1__ clearly.';

  it('keeps every placeholder exactly once and in order', () => {
    for (const instruction of [CONCISE, GRAMMAR, FORMAL, 'make it warmer']) {
      const reply = stubInlineEditReply(masked, instruction);
      expect(stubKeepsPlaceholders(masked, reply)).toBe(true);
      expect(reply).not.toBe(masked);
      expect(reply.length).toBeLessThan(masked.length * 5 + 100);
    }
  });

  it('is byte-identical for the same input', () => {
    expect(stubInlineEditReply(masked, CONCISE)).toBe(stubInlineEditReply(masked, CONCISE));
    expect(stubInlineEditReply('We ran the very long experiment.', CONCISE))
      .toBe('We ran the long experiment.');
    expect(stubInlineEditReply('i can get it done.', GRAMMAR)).toBe('I can get it done.');
    expect(stubInlineEditReply("We can't get it done.", FORMAL)).toBe('We cannot obtain it done.');
  });

  it('streams chunks that reassemble to exactly the same reply', () => {
    const chunks = stubInlineEditChunks(masked, CONCISE);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(stubInlineEditReply(masked, CONCISE));
    // Protected bytes are never split across deltas.
    for (const chunk of chunks) {
      const partial = /@@PROTECTED_\d$/.test(chunk);
      expect(partial).toBe(false);
    }
  });
});

describe('dev stub completions', () => {
  it('produces prose both format filters accept', () => {
    const prefix = 'We measured the result once and then';
    const insertion = stubCompletion(prefix);
    expect(insertion.length).toBeGreaterThan(3);
    expect(insertion.length).toBeLessThan(200);
    expect(filterCompletion(insertion, prefix).accepted).toBe(true);
    expect(filterMarkdownCompletion(insertion, prefix).accepted).toBe(true);
    expect(stubCompletion(prefix)).toBe(insertion);
  });

  it('offers nothing on the documented dev trigger so Retry is reachable', () => {
    expect(stubCompletion('wait for timeout')).toBe('');
    expect(stubCompletion('wait for none')).toBe('');
  });
});

describe('stubbed provider responses', () => {
  it('looks like a single chat completion response', async () => {
    const response = stubProviderResponse('Overall, plainer prose.');
    const data = await response.json();
    expect(data.choices[0].message.content).toBe('Overall, plainer prose.');
  });

  it('looks like a provider SSE stream and survives the route parser', async () => {
    const reply = stubInlineEditReply('Some prose with `code` inside.', CONCISE);
    const response = stubStreamResponse(stubInlineEditChunks('Some prose with `code` inside.', CONCISE));
    let assembled = '';
    let sawDone = false;
    for (const line of (await response.text()).split('\n')) {
      const parsed = parseProviderSseLine(line);
      if (parsed.kind === 'text') assembled += parsed.text;
      if (parsed.kind === 'done') sawDone = true;
    }
    expect(sawDone).toBe(true);
    expect(assembled).toBe(reply);
  });
});

describe('stubbed stream pacing', () => {
  it('reads the development delay and clamps it', () => {
    delete process.env.AI_DEV_STUB_DELAY_MS;
    expect(aiDevStubDelayMs()).toBe(0);
    vi.stubEnv('AI_DEV_STUB_DELAY_MS', '180');
    expect(aiDevStubDelayMs()).toBe(180);
    vi.stubEnv('AI_DEV_STUB_DELAY_MS', '99999');
    expect(aiDevStubDelayMs()).toBe(500);
    vi.stubEnv('AI_DEV_STUB_DELAY_MS', 'not-a-number');
    expect(aiDevStubDelayMs()).toBe(0);
    vi.stubEnv('AI_DEV_STUB_DELAY_MS', '-5');
    expect(aiDevStubDelayMs()).toBe(0);
  });

  it('delays each chunk but produces the same bytes', async () => {
    const masked = 'Some prose with `code` inside.';
    const chunks = stubInlineEditChunks(masked, CONCISE);
    const started = Date.now();
    const response = stubStreamResponse(chunks, 5);
    let assembled = '';
    for (const line of (await response.text()).split('\n')) {
      const parsed = parseProviderSseLine(line);
      if (parsed.kind === 'text') assembled += parsed.text;
    }
    expect(assembled).toBe(stubInlineEditReply(masked, CONCISE));
    expect(Date.now() - started).toBeGreaterThanOrEqual((chunks.length - 1) * 5);
  });
});
