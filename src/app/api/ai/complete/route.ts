import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { openWritableDocument } from '@/src/lib/document-lookup';
import { prisma } from '@/src/lib/db';
import { z } from 'zod';
import { acquireAiSlot, checkAiRateLimit } from '@/src/lib/ai-rate-limit';
import { filterCompletion } from '@/src/lib/latex-utils';
import { filterMarkdownCompletion, markdownLineIsProse, scanMarkdownContext } from '@/src/lib/markdown-utils';
import { parseProviderSseLine } from '@/src/lib/inline-edit-stream';
import {
  encodeCompleteEvent,
  GHOST_TEXT_MAX_INSERTION,
  GHOST_TEXT_STREAM_MAX_CHARS,
  type CompleteStreamEvent,
} from '@/src/lib/ghost-text';
import {
  aiDevStubDelayMs,
  aiDevStubEnabled,
  AI_DEV_STUB_MODEL,
  stubCompletion,
  stubCompletionChunks,
  stubProviderResponse,
  stubStreamResponse,
} from '@/src/lib/ai-dev-stub';

const completeSchema = z.object({
  documentId: z.string().min(1).max(128),
  prefix: z.string().max(2_000),
  suffix: z.string().max(1_000),
  requestId: z.string().max(128).optional(),
  stream: z.boolean().optional(),
});

// The real configured provider and model, reported on every response that
// reached the provider stage so the editor's status chip names the actual
// model instead of a hard-coded label.
const PROVIDER_NAME = 'openrouter';
const MODEL_NAME = 'openai/gpt-4o-mini';

export const POST = withAuth(async (req, session) => {
  // Set while a streamed exchange holds the AI slot so a throw cannot leak it.
  let releaseStreamResources: (() => Promise<void>) | null = null;
  try {
    if (Number(req.headers.get('content-length')) > 8_000) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    }
    const body = await req.json();
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { documentId, prefix, suffix } = parsed.data;
    const userId = session.user.id;

    // Rate limit
    const rl = await checkAiRateLimit(userId, 'complete');
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
      });
    }

    // Author-only. AI consumes quota and may expose document content to a provider, so a shared
    // reader gets the same 404 as an unrelated user. Format comes from the row, never the client.
    const aiAccess = await openWritableDocument(userId, documentId);
    if (!aiAccess) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const doc = { id: aiAccess.document.id, format: aiAccess.document.format };
    const isMarkdown = doc.format === 'MARKDOWN';

    // Don't suggest for empty prefix
    if (!prefix || prefix.trim().length === 0) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }

    // Call AI
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    // Development sandbox only: a deterministic reply stands in for the
    // provider. Every filter and authorization rule still runs on it.
    const stubbed = aiDevStubEnabled();
    if (!openRouterKey && !stubbed) {
      return NextResponse.json({ insertion: null, error: 'AI completion unavailable' }, { status: 503 });
    }
    const providerName = stubbed ? 'dev-stub' : PROVIDER_NAME;
    const modelName = stubbed ? AI_DEV_STUB_MODEL : MODEL_NAME;


    let prompt: string;
    if (isMarkdown) {
      // Server-side re-scan of the caret context (defense in depth against a
      // malicious or buggy client): no suggestions in protected Markdown.
      const caretContext = scanMarkdownContext(prefix, prefix.length);
      const lastLineMd = prefix.split('\n').pop() || '';
      if (caretContext.inProtected || !markdownLineIsProse(lastLineMd)) {
        return NextResponse.json({ insertion: null }, { status: 200 });
      }
      prompt = `Complete the following Markdown prose with a short continuation (at most one phrase or sentence, roughly 3-30 words). Return ONLY the completion text — no explanations, no quotes.

Prefix (what was already written):
"""${prefix}"""

Suffix (text that follows):
"""${suffix}"""

Rules:
- Complete at most one phrase or sentence of plain prose.
- Do NOT repeat the prefix.
- Do NOT output Markdown syntax: no #, *, _, backticks, links, images, lists, tables, or HTML.
- Return only the addition.`;
    } else {
      const lastLine = prefix.split('\n').pop() || '';
      // Only suggest for text that's part of prose — rough heuristic
      if (/^\\/.test(lastLine.trim()) || /\$\s*$/.test(lastLine.trim())) {
        return NextResponse.json({ insertion: null }, { status: 200 });
      }

      prompt = `Complete the following LaTeX prose with a short continuation (at most one phrase or sentence, roughly 3-30 words). Return ONLY the completion text — no explanations, no markdown, no quotes.

Prefix (what was already written):
"""${prefix}"""

Suffix (text that follows):
"""${suffix}"""

Rules:
- Complete at most one phrase or sentence.
- Do NOT repeat the prefix.
- Do NOT wrap in markdown or quotes.
- Do NOT output LaTeX commands like \\section or \\begin.
- Return only the addition.`;
    }

    const releaseSlot = await acquireAiSlot(userId, 'complete');
    if (!releaseSlot) return NextResponse.json({ insertion: null }, { status: 429, headers: { 'Retry-After': '1' } });

    const wantStream = parsed.data.stream === true;

    // One 10-second budget bounds connect + body; a client disconnect or a
    // Stop (abort) propagates to the provider. The AI slot is held for the
    // whole streamed exchange and released exactly once on close/error/cancel.
    const abortController = new AbortController();
    let timedOut = false;
    const onClientGone = () => abortController.abort();
    req.signal.addEventListener('abort', onClientGone);
    const timeoutId = setTimeout(() => { timedOut = true; abortController.abort(); }, 10_000);
    let slotHeld = true;
    const releaseSlotNow = async () => { if (slotHeld) { slotHeld = false; await releaseSlot(); } };
    const clearGuards = () => {
      clearTimeout(timeoutId);
      req.signal.removeEventListener('abort', onClientGone);
    };
    releaseStreamResources = async () => { clearGuards(); await releaseSlotNow(); };

    let aiResponse: Response;
    try {
      aiResponse = stubbed
        ? (wantStream
            ? stubStreamResponse(stubCompletionChunks(prefix), aiDevStubDelayMs())
            : stubProviderResponse(stubCompletion(prefix)))
        : await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: isMarkdown
            ? 'You are a Markdown writing assistant. Complete the user\'s prose with a short plain-text continuation. Return only the completion text.'
            : 'You are a LaTeX writing assistant. Complete the user\'s text with a short prose continuation. Return only the completion text.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.4,
        ...(wantStream ? { stream: true } : {}),
      }),
      signal: wantStream ? abortController.signal : AbortSignal.timeout(10_000),
      });
    } finally {
      if (!wantStream) await releaseSlotNow();
    }

    if (!aiResponse.ok) {
      await releaseSlotNow();
      clearGuards();
      console.error('[AI_COMPLETE] Provider error:', aiResponse.status);
      return NextResponse.json({ insertion: null, error: 'AI completion unavailable' }, { status: 502 });
    }

    if (wantStream) {
      // The streamed exchange now owns the slot and the guards; they release
      // on the terminal event, a provider/transport failure, or a client cancel.
      return completeStreamResponse({
        aiResponse,
        clientSignal: req.signal,
        abortController,
        isMarkdown,
        prefix,
        providerName,
        modelName,
        releaseSlotNow,
        clearGuards,
        didTimeOut: () => timedOut,
      });
    }

    // Single-response path: the slot is already released at header time.
    clearGuards();

    const aiData = await aiResponse.json();
    const insertion: unknown = aiData?.choices?.[0]?.message?.content;

    // Filter with format-specific syntax rules.
    const filterResult = typeof insertion === 'string'
      ? (isMarkdown ? filterMarkdownCompletion(insertion, prefix) : filterCompletion(insertion, prefix))
      : { accepted: false };
    if (!filterResult.accepted) {
      return NextResponse.json({ insertion: null, provider: providerName, model: modelName }, { status: 200 });
    }

    return NextResponse.json({ insertion, provider: providerName, model: modelName }, { status: 200 });

  } catch (error: unknown) {
    await releaseStreamResources?.().catch(() => {});
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return NextResponse.json({ insertion: null, error: 'AI completion timed out' }, { status: 504 });
    }
    console.error('[AI_COMPLETE] Request failed');
    return NextResponse.json({ insertion: null, error: 'AI completion unavailable' }, { status: 502 });
  }
});

// ---------------------------------------------------------------------------
// Streaming response — bounded NDJSON events (delta/done/error) per the
// Ghost text plan section. Deltas show the provider text as it arrives; the
// terminal done event carries the filtered, final insertion plus the real
// provider/model names. Cumulative size is capped, provider reads abort with
// the client, and the AI slot is held for the whole exchange.
// ---------------------------------------------------------------------------

type CompleteStreamParams = {
  aiResponse: Response;
  clientSignal: AbortSignal;
  abortController: AbortController;
  isMarkdown: boolean;
  prefix: string;
  providerName: string;
  modelName: string;
  releaseSlotNow: () => Promise<void>;
  clearGuards: () => void;
  didTimeOut: () => boolean;
};

function completeStreamResponse(params: CompleteStreamParams): Response {
  const {
    aiResponse, clientSignal, abortController, isMarkdown, prefix,
    providerName, modelName, releaseSlotNow, clearGuards, didTimeOut,
  } = params;
  const encoder = new TextEncoder();
  const upstream = aiResponse.body;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: CompleteStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeCompleteEvent(event)));
        } catch {
          // The consumer is gone; the finally block still releases everything.
        }
      };
      const finish = async () => {
        clearGuards();
        try { controller.close(); } catch { /* already closed or cancelled */ }
        await releaseSlotNow();
      };
      void (async () => {
        if (!upstream) {
          send({ type: 'error', code: 'provider', message: 'AI service returned no stream' });
          await finish();
          return;
        }
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';
        let stopped = false;
        try {
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const parsedLine = parseProviderSseLine(line);
              if (parsedLine.kind === 'done') break;
              if (parsedLine.kind === 'provider-error') {
                send({ type: 'error', code: 'provider', message: 'AI completion unavailable' });
                stopped = true;
                break;
              }
              if (parsedLine.kind === 'text') {
                assembled += parsedLine.text;
                if (assembled.length > GHOST_TEXT_STREAM_MAX_CHARS) {
                  send({ type: 'error', code: 'too_large', message: 'AI completion too large' });
                  stopped = true;
                  break;
                }
                send({ type: 'delta', text: parsedLine.text });
              }
            }
          }
          if (stopped) {
            await reader.cancel().catch(() => {});
            return;
          }
          if (clientSignal.aborted) return;
          // Same final contract as the single-response route: a filtered or
          // empty completion is a done event with insertion null, never an
          // error the client must special-case.
          const filterResult = assembled.trim() === ''
            ? { accepted: false }
            : (isMarkdown ? filterMarkdownCompletion(assembled, prefix) : filterCompletion(assembled, prefix));
          if (!filterResult.accepted || assembled.length > GHOST_TEXT_MAX_INSERTION) {
            send({ type: 'done', insertion: null, provider: providerName, model: modelName });
            return;
          }
          send({ type: 'done', insertion: assembled, provider: providerName, model: modelName });
        } catch (error: unknown) {
          if (clientSignal.aborted) return;
          if (didTimeOut() || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
            send({ type: 'error', code: 'timeout', message: 'AI completion timed out' });
          } else {
            console.error('[AI_COMPLETE] Stream failed');
            send({ type: 'error', code: 'provider', message: 'AI completion unavailable' });
          }
        } finally {
          await finish();
        }
      })();
    },
    async cancel() {
      // Client hung up mid-stream: stop the provider and free the slot.
      abortController.abort();
      clearGuards();
      await releaseSlotNow();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}
