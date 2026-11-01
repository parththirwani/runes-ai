// Inline edit streaming protocol — pure helpers for plan step 3 of
// docs/ai-inline-edit-plan.md ("Streaming"). The route emits NDJSON events
// (delta / done / noop / error); the editor client consumes them with the
// reader below. Deltas carry the masked provider text — protected source
// bytes only ever travel in the terminal `done` event after the server has
// verified the restore — so the client preview uses restoreMaskedPreview to
// show real protected spans byte-for-byte while never flashing a half-formed
// placeholder. No React, no Monaco, no fetch.

import { PLACEHOLDER_PREFIX, escapeRegex, extractProtectedLatexTokens } from './latex-utils';
import { extractProtectedMarkdownTokens } from './markdown-utils';

// -------------------------------------------------------------------------
// Events
// -------------------------------------------------------------------------

export type InlineEditStreamErrorCode =
  | 'empty'
  | 'too_large'
  | 'protected'
  | 'timeout'
  | 'provider'
  | 'protocol';

export type InlineEditStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; replacementText: string }
  | { type: 'noop'; explanation: string }
  | { type: 'error'; code: InlineEditStreamErrorCode; message: string };

/** One JSON object per line — the exact bytes the route writes. */
export function encodeInlineEditEvent(event: InlineEditStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function isEventCode(value: unknown): value is InlineEditStreamErrorCode {
  return value === 'empty' || value === 'too_large' || value === 'protected' ||
    value === 'timeout' || value === 'provider' || value === 'protocol';
}

function parseEventLine(line: string): InlineEditStreamEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as Record<string, unknown>;
  switch (event.type) {
    case 'delta':
      return typeof event.text === 'string' ? { type: 'delta', text: event.text } : null;
    case 'done':
      return typeof event.replacementText === 'string' ? { type: 'done', replacementText: event.replacementText } : null;
    case 'noop':
      return typeof event.explanation === 'string' ? { type: 'noop', explanation: event.explanation } : null;
    case 'error':
      return isEventCode(event.code) && typeof event.message === 'string'
        ? { type: 'error', code: event.code, message: event.message }
        : null;
    default:
      return null;
  }
}

/**
 * Consume the route's NDJSON body. Incomplete lines are buffered across
 * chunks; a malformed line ends the stream with a protocol error event. The
 * reader is pull-based: stopping iteration cancels the underlying body so a
 * discarded response never keeps the connection open.
 */
export async function* readInlineEditStream(
  body: ReadableStream<Uint8Array> | null | undefined,
): AsyncGenerator<InlineEditStreamEvent> {
  if (!body) {
    yield { type: 'error', code: 'protocol', message: 'AI service returned no stream' };
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const event = parseEventLine(line);
        if (!event) {
          yield { type: 'error', code: 'protocol', message: 'Malformed AI stream event' };
          return;
        }
        yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== '') {
      const event = parseEventLine(buffer);
      if (!event) {
        yield { type: 'error', code: 'protocol', message: 'Malformed AI stream event' };
        return;
      }
      yield event;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// -------------------------------------------------------------------------
// Masked preview restore (client side, display only)
// -------------------------------------------------------------------------

const FULL_PLACEHOLDER_LINE = new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}\\d+__`, 'g');
const FULL_PLACEHOLDER_ONE = new RegExp(`^${escapeRegex(PLACEHOLDER_PREFIX)}\\d+__$`);
const PARTIAL_TAIL = /^\d*(_\d*)?$/;

/** True for text that is not yet a full placeholder but could still become one. */
export function isPartialPlaceholder(text: string): boolean {
  if (text === '') return false;
  if (FULL_PLACEHOLDER_ONE.test(text)) return false;
  if (PLACEHOLDER_PREFIX.startsWith(text)) return true;
  if (text.startsWith(PLACEHOLDER_PREFIX)) {
    // Digits may still arrive (or one closing underscore, optimistically —
    // holding a few extra characters is safe, showing a completable prefix is not).
    return PARTIAL_TAIL.test(text.slice(PLACEHOLDER_PREFIX.length));
  }
  return false;
}

export type MaskedPreviewTokens = { placeholder: string; original: string }[];

/**
 * Rebuild the server masking table on the client so a streamed preview can show
 * real protected bytes. The route masks with `@@PROTECTED_<n>__` in the order
 * its patterns match; extractProtected*Tokens walks the identical pattern list,
 * so renumbering by index reproduces the same placeholder-to-original pairs.
 * Display only: applying still uses the verified terminal `done` text.
 */
export function maskedTokensForPreview(originalSelection: string, format: 'markdown' | 'latex'): MaskedPreviewTokens {
  const originals = format === 'markdown'
    ? extractProtectedMarkdownTokens(originalSelection)
    : extractProtectedLatexTokens(originalSelection);
  return originals.map((original, index) => ({ placeholder: `${PLACEHOLDER_PREFIX}${index}__`, original }));
}

/**
 * Split accumulated masked text into the part that is safe to display and a
 * trailing fragment that could still grow into a placeholder. Completed
 * placeholders inside the visible part are replaced with their original
 * bytes (unknown indexes stay as-is; the server rejects such output at the
 * terminal event anyway). This is a rendering helper only — applying an edit
 * always uses the verified `done` text, never a preview.
 */
export function restoreMaskedPreview(
  masked: string,
  tokens: MaskedPreviewTokens,
): { visible: string; held: string } {
  let holdStart = -1;
  for (let i = masked.length - 1; i >= 0; i--) {
    if (masked[i] !== '@') continue;
    const suffix = masked.slice(i);
    if (isPartialPlaceholder(suffix)) {
      holdStart = i;
      break;
    }
    if (FULL_PLACEHOLDER_ONE.test(suffix)) break;
  }
  const base = holdStart === -1 ? masked : masked.slice(0, holdStart);
  const held = holdStart === -1 ? '' : masked.slice(holdStart);
  if (tokens.length === 0) return { visible: base, held };
  const byPlaceholder = new Map(tokens.map((token) => [token.placeholder, token.original]));
  const visible = base.replace(FULL_PLACEHOLDER_LINE, (match) => byPlaceholder.get(match) ?? match);
  return { visible, held };
}

// -------------------------------------------------------------------------
// Provider SSE parsing (server side, OpenRouter chat completions)
// -------------------------------------------------------------------------

export type ProviderSseLine =
  | { kind: 'text'; text: string }
  | { kind: 'done' }
  | { kind: 'provider-error' }
  | { kind: 'ignore' };

/**
 * Parse one line of an OpenAI-compatible SSE body into the streamed content
 * delta. Blank lines, comments, and chunks without text content are ignored;
 * an in-band `error` payload surfaces as provider-error so the route can
 * terminate with its own safe error event.
 */
export function parseProviderSseLine(line: string): ProviderSseLine {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith(':')) return { kind: 'ignore' };
  if (!trimmed.startsWith('data:')) return { kind: 'ignore' };
  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '[DONE]') return { kind: 'done' };
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { kind: 'ignore' };
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'ignore' };
  const parsed = raw as Record<string, unknown>;
  if (parsed.error !== undefined) return { kind: 'provider-error' };
  const choices = parsed.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const delta = typeof first === 'object' && first !== null ? (first as Record<string, unknown>).delta : undefined;
  const text = typeof delta === 'object' && delta !== null ? (delta as Record<string, unknown>).content : undefined;
  return typeof text === 'string' && text !== '' ? { kind: 'text', text } : { kind: 'ignore' };
}
