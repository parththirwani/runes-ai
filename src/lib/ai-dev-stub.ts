// Development-only provider stub. No API key exists in local or CI sandboxes, and
// the plan requires the full edit and autocomplete journeys to be walkable in a
// browser, so this module replaces only the provider *reply* — never a route's
// authorization, quota, protection, size, or timeout rules. It is enabled solely
// by AI_DEV_STUB=1 in a development build, replies deterministically (same input,
// same bytes), keeps every @@PROTECTED_N__ placeholder verbatim and in order, and
// is fed through the exact same validation path as a real provider response.
// Nothing here logs document source or instructions.

import { PLACEHOLDER_PREFIX } from './latex-utils';

const PLACEHOLDER_RUN = /@@PROTECTED_\d+__/g;

/** True only in a development server with the explicit opt-in flag. */
export function aiDevStubEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.AI_DEV_STUB === '1';
}

/** Reported as the model name on the status chip when the stub answers. */
export const AI_DEV_STUB_MODEL = 'dev-stub (no provider)';

function lowercaseFirst(text: string): string {
  const lead = text.slice(0, text.length - text.trimStart().length);
  const body = text.trimStart();
  if (!body) return text;
  return lead + body.charAt(0).toLowerCase() + body.slice(1);
}

/**
 * Deterministic replacement for a masked selection. Every branch keeps the
 * placeholders untouched, and the final fallback always changes at least one
 * prose byte so a stubbed reply can never look like a no-op echo.
 */
export function stubInlineEditReply(maskedSelection: string, instruction: string): string {
  const text = maskedSelection;
  if (/\bconcise|shorter\b/i.test(instruction)) {
    const tightened = text.replace(/\b(?:very|really|quite|just|actually|basically|in fact)\s+/gi, '');
    if (tightened !== text && tightened.trim() !== '') return tightened;
  }
  if (/grammar|spelling|punctuat/i.test(instruction)) {
    const fixed = text.replace(/\s+([,.;:!?])/g, '$1').replace(/\bi\b/g, 'I');
    if (fixed !== text) return fixed;
  }
  if (/\bformal\b|\bacademic\b/i.test(instruction)) {
    const formal = text
      .replace(/\bdon'?t\b/gi, 'do not')
      .replace(/\bcan'?t\b/gi, 'cannot')
      .replace(/\bwon'?t\b/gi, 'will not')
      .replace(/\bget\b/gi, 'obtain');
    if (formal !== text) return formal;
  }
  return `Overall, ${lowercaseFirst(text)}`;
}

/**
 * Stream the same reply in small word groups. Splitting on whitespace can never
 * break a placeholder because placeholders contain no whitespace.
 */
export function stubInlineEditChunks(maskedSelection: string, instruction: string, wordsPerChunk = 4): string[] {
  const reply = stubInlineEditReply(maskedSelection, instruction);
  const parts = reply.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  let words = 0;
  for (const part of parts) {
    current += part;
    if (/\S/.test(part)) words += 1;
    if (words >= wordsPerChunk) {
      chunks.push(current);
      current = '';
      words = 0;
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * Deterministic ghost-text continuation. The final word of the prefix acts as a
 * dev trigger: 'timeout' produces no suggestion at all so the "No suggestion"
 * and Retry states are reachable without a live provider (same trick the public
 * reference demo documents).
 */
export function stubCompletion(prefix: string): string {
  const lastWord = /(\S+)\s*$/.exec(prefix)?.[1]?.toLowerCase() ?? '';
  if (lastWord === 'timeout' || lastWord === 'none') return '';
  return ' and the same pattern held across the next set of runs';
}

/** True when a stubbed reply still carries every placeholder exactly once. */
export function stubKeepsPlaceholders(original: string, reply: string): boolean {
  const count = (text: string): string[] => text.match(PLACEHOLDER_RUN) ?? [];
  const before = count(original);
  const after = count(reply);
  if (before.length !== after.length) return false;
  return before.every((token, index) => token === after[index]);
}

export function stubPlaceholdersOf(text: string): string[] {
  return text.match(new RegExp(`${PLACEHOLDER_PREFIX}\\d+__`, 'g')) ?? [];
}

// ---------------------------------------------------------------------------
// Response shapes — a stubbed reply enters the route as the same Response
// objects a provider would return, so nothing downstream is special-cased.
// ---------------------------------------------------------------------------

export function stubProviderResponse(reply: string): Response {
  return Response.json({ choices: [{ message: { content: reply } }] });
}

/**
 * Optional pacing for the stubbed stream so a browser can observe the real
 * streaming states (word reveal, Stop) instead of jumping straight to review.
 * Development only, and capped well inside the route's 15-second budget.
 */
export function aiDevStubDelayMs(): number {
  const raw = Number(process.env.AI_DEV_STUB_DELAY_MS ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(500, Math.floor(raw));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stubStreamResponse(chunks: string[], delayMs = 0): Response {
  const encoder = new TextEncoder();
  const doneLine = encoder.encode('data: [DONE]\n\n');
  let index = 0;
  let sentDone = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        if (delayMs > 0) await wait(delayMs);
        const chunk = chunks[index];
        index += 1;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
        return;
      }
      if (!sentDone) {
        sentDone = true;
        controller.enqueue(doneLine);
        return;
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}
