import { describe, expect, it } from 'vitest';
import {
  encodeInlineEditEvent,
  isPartialPlaceholder,
  parseProviderSseLine,
  readInlineEditStream,
  restoreMaskedPreview,
  type InlineEditStreamEvent,
} from '@/src/lib/inline-edit-stream';

const enc = new TextEncoder();

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array> | null): Promise<InlineEditStreamEvent[]> {
  const events: InlineEditStreamEvent[] = [];
  for await (const event of readInlineEditStream(body)) events.push(event);
  return events;
}

describe('encodeInlineEditEvent', () => {
  it('writes exactly one JSON object per line', () => {
    const line = encodeInlineEditEvent({ type: 'delta', text: 'a\nb "quoted"' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ type: 'delta', text: 'a\nb "quoted"' });
  });
});

describe('readInlineEditStream', () => {
  it('yields events across chunk boundaries, including mid-line and mid-multibyte splits', async () => {
    const full =
      encodeInlineEditEvent({ type: 'delta', text: 'The café ' }) +
      encodeInlineEditEvent({ type: 'delta', text: 'is bright' }) +
      encodeInlineEditEvent({ type: 'done', replacementText: 'The café is bright.' });
    const bytes = enc.encode(full);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
    const events = await collect(streamOf(chunks));
    expect(events).toEqual([
      { type: 'delta', text: 'The café ' },
      { type: 'delta', text: 'is bright' },
      { type: 'done', replacementText: 'The café is bright.' },
    ]);
  });

  it('parses a final line that arrives without a trailing newline and skips blank lines', async () => {
    const events = await collect(streamOf([
      '\n',
      '{"type":"noop","explanation":"No change suggested"}\n\n',
      '{"type":"error","code":"timeout","message":"AI request timed out"}',
    ]));
    expect(events).toEqual([
      { type: 'noop', explanation: 'No change suggested' },
      { type: 'error', code: 'timeout', message: 'AI request timed out' },
    ]);
  });

  it('ends with a protocol error on a malformed event line and stops reading', async () => {
    const events = await collect(streamOf([
      '{"type":"delta","text":"ok"}\n',
      'not json at all\n',
      '{"type":"done","replacementText":"never"}\n',
    ]));
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('error');
    expect(events[1]).toMatchObject({ code: 'protocol' });
  });

  it('rejects events with the wrong field shape', async () => {
    const events = await collect(streamOf(['{"type":"delta","text":42}\n']));
    expect(events).toEqual([{ type: 'error', code: 'protocol', message: 'Malformed AI stream event' }]);
  });

  it('reports a protocol error when the body is missing', async () => {
    const events = await collect(null);
    expect(events).toEqual([{ type: 'error', code: 'protocol', message: 'AI service returned no stream' }]);
  });
});

describe('isPartialPlaceholder', () => {
  it('accepts every proper prefix of a placeholder and nothing completed', () => {
    for (const partial of ['@', '@@', '@@P', '@@PROTECTED', '@@PROTECTED_', '@@PROTECTED_12', '@@PROTECTED_12_']) {
      expect(isPartialPlaceholder(partial)).toBe(true);
    }
    expect(isPartialPlaceholder('@@PROTECTED_12__')).toBe(false);
    expect(isPartialPlaceholder('@@x')).toBe(false);
    expect(isPartialPlaceholder('a@')).toBe(false);
    expect(isPartialPlaceholder('')).toBe(false);
  });
});

describe('restoreMaskedPreview', () => {
  const tokens = [
    { placeholder: '@@PROTECTED_0__', original: '\\cite{key}' },
    { placeholder: '@@PROTECTED_1__', original: '`x + 1`' },
  ];

  it('restores completed placeholders byte-for-byte', () => {
    const { visible, held } = restoreMaskedPreview('The result @@PROTECTED_0__ and `code` @@PROTECTED_1__ end.', tokens);
    expect(visible).toBe('The result \\cite{key} and `code` `x + 1` end.');
    expect(held).toBe('');
  });

  it('holds back a trailing partial placeholder instead of flashing it', () => {
    const { visible, held } = restoreMaskedPreview('The result @@PROTE', tokens);
    expect(visible).toBe('The result ');
    expect(held).toBe('@@PROTE');
  });

  it('holds a completed placeholder only after its final underscore arrives', () => {
    const growing = ['The x @@PROTECTED_1', 'The x @@PROTECTED_1_', 'The x @@PROTECTED_1__'];
    const results = growing.map((text) => restoreMaskedPreview(text, tokens));
    expect(results[0]).toEqual({ visible: 'The x ', held: '@@PROTECTED_1' });
    expect(results[1]).toEqual({ visible: 'The x ', held: '@@PROTECTED_1_' });
    expect(results[2]).toEqual({ visible: 'The x `x + 1`', held: '' });
  });

  it('treats a lone trailing @ as holdable but shows stray @ mid-text', () => {
    expect(restoreMaskedPreview('mail me @', tokens)).toEqual({ visible: 'mail me ', held: '@' });
    expect(restoreMaskedPreview('a@b continues', tokens)).toEqual({ visible: 'a@b continues', held: '' });
  });

  it('keeps unknown completed placeholder indexes verbatim rather than inventing text', () => {
    const { visible, held } = restoreMaskedPreview('odd @@PROTECTED_7__ tail', tokens);
    expect(visible).toBe('odd @@PROTECTED_7__ tail');
    expect(held).toBe('');
  });

  it('never holds text that begins inside a restored original', () => {
    const emailTokens = [{ placeholder: '@@PROTECTED_0__', original: '[me](mailto:a@b.dev)' }];
    const { visible, held } = restoreMaskedPreview('write to @@PROTECTED_0__ today', emailTokens);
    expect(visible).toBe('write to [me](mailto:a@b.dev) today');
    expect(held).toBe('');
  });

  it('passes masked text through unchanged when there are no tokens', () => {
    const { visible, held } = restoreMaskedPreview('plain words', []);
    expect(visible).toBe('plain words');
    expect(held).toBe('');
  });
});

describe('parseProviderSseLine', () => {
  it('extracts streamed content deltas', () => {
    expect(parseProviderSseLine('data: {"choices":[{"delta":{"content":"The "}}]}')).toEqual({ kind: 'text', text: 'The ' });
  });

  it('recognizes the terminal [DONE] marker', () => {
    expect(parseProviderSseLine('data: [DONE]')).toEqual({ kind: 'done' });
  });

  it('ignores blanks, comments, non-data lines, garbage, and content-free deltas', () => {
    expect(parseProviderSseLine('')).toEqual({ kind: 'ignore' });
    expect(parseProviderSseLine(': keep-alive')).toEqual({ kind: 'ignore' });
    expect(parseProviderSseLine('event: message')).toEqual({ kind: 'ignore' });
    expect(parseProviderSseLine('data: {oops')).toEqual({ kind: 'ignore' });
    expect(parseProviderSseLine('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toEqual({ kind: 'ignore' });
    expect(parseProviderSseLine('data: {"choices":[{"delta":{"content":""}}]}')).toEqual({ kind: 'ignore' });
  });

  it('surfaces an in-band provider error payload', () => {
    expect(parseProviderSseLine('data: {"error":{"message":"boom"}}')).toEqual({ kind: 'provider-error' });
  });
});
