// Ghost text autocomplete — pure model for docs/ai-inline-edit-plan.md
// §"Ghost text autocomplete". Everything the plan pins down as behavior
// (debounce length, word-acceptance boundary, matching-typed consumption,
// chip states with text labels, retryable errors, and the bounded streaming
// protocol for /api/ai/complete) lives here as pure functions so the Monaco
// wiring and the route can stay thin and testable. No React, no Monaco.

// The reference pauses roughly 450 ms after typing before suggesting; the
// old provider used 400 ms. The plan says to adopt the reference's number.
export const GHOST_TEXT_DEBOUNCE_MS = 450;

/** Insertions longer than this are dropped by the client, exactly as before. */
export const GHOST_TEXT_MAX_INSERTION = 200;

/** Server-side cumulative cap on a streamed completion before it is cut off. */
export const GHOST_TEXT_STREAM_MAX_CHARS = 400;

// -------------------------------------------------------------------------
// Eligibility
// -------------------------------------------------------------------------

export type GhostEligibilityInput = {
  enabled: boolean;
  canEdit: boolean;
  hasSelection: boolean;
  /** True while the inline-edit prompt, request, or review surface is open. */
  inlineEditOpen: boolean;
};

/** Null means a suggestion may be attempted; otherwise the honest reason. */
export function ghostEligibilityReason(input: GhostEligibilityInput): string | null {
  if (!input.enabled) return 'AI completion is off';
  if (!input.canEdit) return 'You do not have edit access';
  if (input.hasSelection) return 'Clear the selection to get completions';
  if (input.inlineEditOpen) return 'Finish the inline edit first';
  return null;
}

// -------------------------------------------------------------------------
// Word acceptance (mirrors Monaco's acceptNextWord splitting rule)
// -------------------------------------------------------------------------

// Monaco's default word definition: runs of word characters, where anything
// outside this class (punctuation, spaces) acts as a separator. Kept for the
// consume/mismatch checks; the split below uses a prose-friendly boundary.
const GHOST_WS_OR_WORD = /^\s*\S+\s*/;

/**
 * Split a suggestion into the slice a single word-accept takes and the
 * remainder that stays visible. The accepted slice owns any leading
 * whitespace plus the first non-space token plus the whitespace after it, so
 * the caret lands exactly at the start of the next word and the remainder is
 * a clean continuation (a completion beginning with " and the" accepts
 * " and " and leaves "the"). This mirrors the intent of Monaco's native
 * acceptNextWord for the prose continuations this route produces; the native
 * command owns the boundary in the normal path, and this reference split is
 * used by the manual fallback and the tests.
 */
export function nextGhostWord(suggestion: string): { accepted: string; remainder: string } {
  const match = GHOST_WS_OR_WORD.exec(suggestion);
  if (!match) {
    return { accepted: suggestion, remainder: '' };
  }
  const accepted = match[0];
  return { accepted, remainder: suggestion.slice(accepted.length) };
}

// -------------------------------------------------------------------------
// Matching-typed consumption
// -------------------------------------------------------------------------

/**
 * When the user types while a ghost is visible, the typed text is checked
 * against the suggestion locally: a matching prefix trims the ghost without
 * a refetch, and typing the whole suggestion dismisses it (empty remainder).
 * A mismatch returns null — the caller clears the ghost and restarts the
 * debounce instead of showing text the user has left behind.
 */
export function consumeGhostByTyping(suggestion: string, typed: string): string | null {
  if (typed === '') return suggestion;
  if (!suggestion.startsWith(typed)) return null;
  return suggestion.slice(typed.length);
}

// -------------------------------------------------------------------------
// Status chip
// -------------------------------------------------------------------------

export type GhostChipPhase =
  | 'idle'          // no suggestion activity; label shows the model name
  | 'thinking'      // debounce elapsed, request in flight
  | 'ready'         // ghost visible; Tab accepts all
  | 'accepted'      // the suggestion (or its remainder) was inserted
  | 'none'          // the request completed without a suggestion
  | 'unavailable';  // a retryable failure (rate limit, provider, timeout)

export type GhostChipView = {
  label: string;
  retryable: boolean;
  /** Ready accepts by tap on touch devices; the chip never steals focus. */
  acceptable: boolean;
};

/**
 * Chip text. Every state carries a text label (never colour alone) and the
 * model name is whatever the server reported — the client never invents a
 * provider label for a model it did not see.
 */
export function ghostChipView(phase: GhostChipPhase, modelName: string | null): GhostChipView {
  switch (phase) {
    case 'idle':
      return { label: modelName ?? 'AI complete', retryable: false, acceptable: false };
    case 'thinking':
      return { label: 'Thinking…', retryable: false, acceptable: false };
    case 'ready':
      return { label: 'Tab to accept', retryable: false, acceptable: true };
    case 'accepted':
      return { label: 'Accepted', retryable: false, acceptable: false };
    case 'none':
      return { label: 'No suggestion', retryable: false, acceptable: false };
    case 'unavailable':
      return { label: 'No suggestion', retryable: true, acceptable: false };
  }
}

/**
 * Whether the editor toolbar may show the status chip at all. A read-only reader gets
 * no chip (and the provider never runs, see ghostEligibilityReason), so autocomplete is
 * invisible rather than merely inert.
 */
export function shouldShowGhostChip(input: {
  canEdit: boolean;
  autocompleteEnabled: boolean;
  isBinaryActive: boolean;
}): boolean {
  return input.canEdit && input.autocompleteEnabled && !input.isBinaryActive;
}

/** Polite screen-reader text; null keeps the previous announcement. */
export function ghostAnnouncement(phase: GhostChipPhase): string | null {
  switch (phase) {
    case 'ready': return 'AI suggestion ready — press Tab to accept all, Ctrl or Cmd Right for one word';
    case 'accepted': return 'AI suggestion accepted';
    case 'none': return 'AI made no suggestion';
    case 'unavailable': return 'AI completion unavailable — retry is available';
    case 'thinking': return 'AI is thinking';
    default: return null;
  }
}

/** The dismissed notice has no chip phase of its own; it only announces. */
export const GHOST_DISMISSED_ANNOUNCEMENT = 'AI suggestion dismissed';

// -------------------------------------------------------------------------
// Retryable failures
// -------------------------------------------------------------------------

/** Statuses whose message the chip may offer a Retry for (0 = network loss). */
export function isRetryableCompletionStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export function completionNoticeForStatus(status: number): string {
  return status === 429 ? 'AI completion rate limit reached' : 'AI completion unavailable';
}

// -------------------------------------------------------------------------
// /api/ai/complete streaming protocol (NDJSON, bounded)
// -------------------------------------------------------------------------

export type CompleteStreamErrorCode = 'too_large' | 'timeout' | 'provider' | 'protocol';

export type CompleteStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; insertion: string | null; provider: string; model: string }
  | { type: 'error'; code: CompleteStreamErrorCode; message: string };

function isCompleteErrorCode(value: unknown): value is CompleteStreamErrorCode {
  return value === 'too_large' || value === 'timeout' || value === 'provider' || value === 'protocol';
}

/** One JSON object per line — the exact bytes the route writes. */
export function encodeCompleteEvent(event: CompleteStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function parseCompleteEventLine(line: string): CompleteStreamEvent | null {
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
      return (event.insertion === null || typeof event.insertion === 'string')
        && typeof event.provider === 'string' && typeof event.model === 'string'
        ? { type: 'done', insertion: event.insertion, provider: event.provider, model: event.model }
        : null;
    case 'error':
      return isCompleteErrorCode(event.code) && typeof event.message === 'string'
        ? { type: 'error', code: event.code, message: event.message }
        : null;
    default:
      return null;
  }
}

/**
 * Pull-based NDJSON reader for the completion stream. Incomplete lines are
 * buffered across chunks; a malformed line ends the stream with a protocol
 * error; stopping iteration cancels the body so an abandoned suggestion never
 * keeps a connection open.
 */
export async function* readCompleteStream(
  body: ReadableStream<Uint8Array> | null | undefined,
): AsyncGenerator<CompleteStreamEvent> {
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
        const event = parseCompleteEventLine(line);
        if (!event) {
          yield { type: 'error', code: 'protocol', message: 'Malformed AI stream event' };
          return;
        }
        yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== '') {
      const event = parseCompleteEventLine(buffer);
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

/** Identity of a request so a re-trigger can attach instead of refetching. */
export function ghostStreamKey(modelUri: string, offset: number, prefix: string): string {
  return `${modelUri}:${offset}:${prefix.slice(-40)}`;
}
