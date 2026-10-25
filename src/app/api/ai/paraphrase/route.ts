import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { openWritableDocument } from '@/src/lib/document-lookup';
import { prisma } from '@/src/lib/db';
import { z } from 'zod';
import { acquireAiSlot, checkAiRateLimit } from '@/src/lib/ai-rate-limit';
import { analyzeSelection, selectionCutsWord, verifyAndRestore } from '@/src/lib/latex-utils';
import { analyzeMarkdownSelection, scanMarkdownContext, verifyMarkdownRestore } from '@/src/lib/markdown-utils';

const paraphraseSchema = z.object({
  documentId: z.string().min(1, 'documentId is required').max(128),
  selectedText: z.string().min(1, 'selectedText is required').max(10_000),
  before: z.string().max(1_000).default(''),
  after: z.string().max(1_000).default(''),
  tone: z.enum(['Clearer', 'Shorter', 'Formal']).default('Clearer'),
  requestId: z.string().max(128).optional(),
});

export const POST = withAuth(async (req, session) => {
  try {
    if (Number(req.headers.get('content-length')) > 20_000) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    }
    const body = await req.json();
    const parsed = paraphraseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { documentId, selectedText, before, after, tone } = parsed.data;
    const userId = session.user.id;

    // Rate limit check (Redis fallback if offline)
    const rl = await checkAiRateLimit(userId, 'paraphrase');
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
      });
    }

    // Author-only, and format is read from the row so a client cannot claim MARKDOWN for a
    // LaTeX document (or vice versa). A shared reader gets the same 404 as an unrelated user.
    const aiAccess = await openWritableDocument(userId, documentId);
    if (!aiAccess) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const doc = { id: aiAccess.document.id, format: aiAccess.document.format };
    const isMarkdown = doc.format === 'MARKDOWN';

    if (selectionCutsWord(before, selectedText, after)) {
      return NextResponse.json({ error: 'Select complete words' }, { status: 422 });
    }

    let maskedSelection: string;
    let protectedTokens: { placeholder: string; original: string }[];
    let prompt: string;

    if (isMarkdown) {
      const pseudoSource = `${before}${selectedText}${after}`;
      const mdContext = scanMarkdownContext(pseudoSource, before.length);
      const mdAnalysis = analyzeMarkdownSelection(selectedText, mdContext);
      if (!mdAnalysis.eligible) {
        return NextResponse.json({ error: mdAnalysis.reason || 'Unsupported selection' }, { status: 422 });
      }
      maskedSelection = mdAnalysis.maskedSelection;
      protectedTokens = mdAnalysis.protectedTokens;

      const toneInstructionMd = {
        Clearer: 'Make the selected text clearer and more readable while preserving its meaning.',
        Shorter: 'Make the selected text more concise and shorter while preserving its meaning.',
        Formal: 'Make the selected text more formal and academic in tone while preserving its meaning.',
      }[tone];

      prompt = `You are paraphrasing selected prose from a Markdown document. Return ONLY the replacement text — no explanations, no code fences, no JSON.

${toneInstructionMd}

Selected text to paraphrase (protected tokens like @@PROTECTED_0__ stand for code, math, links, images, or emphasis — keep each exactly once, in order):
"""${maskedSelection}"""

Context before the selection:
"""${before}"""

Context after the selection:
"""${after}"""

Rules:
- Change ONLY the plain prose between protected tokens.
- Do NOT add or change Markdown syntax: no headings, list markers, links, images, emphasis, code, tables, or HTML.
- Do NOT introduce URLs.
- Do NOT wrap the output in quotes, backticks, or code fences.
- Return plain text only.`;
    } else {
      const analysis = analyzeSelection(selectedText, {
        isInDocument: true, isInPreamble: false, isInComment: false,
        isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false,
      });
      if (!analysis.eligible) {
        return NextResponse.json({ error: analysis.reason || 'Unsupported selection' }, { status: 422 });
      }
      maskedSelection = analysis.maskedSelection;
      protectedTokens = analysis.protectedTokens;

      const toneInstruction = {
        Clearer: 'Make the selected text clearer and more readable while preserving its meaning and LaTeX structure.',
        Shorter: 'Make the selected text more concise and shorter while preserving its meaning and LaTeX structure.',
        Formal: 'Make the selected text more formal and academic in tone while preserving its meaning and LaTeX structure.',
      }[tone];

      prompt = `You are paraphrasing selected prose from a LaTeX document. Return ONLY the replacement text — no explanations, no markdown fences, no JSON. 

${toneInstruction}

Selected text to paraphrase:
"""${maskedSelection}"""

Context before the selection:
"""${before}"""

Context after the selection:
"""${after}"""

Rules:
- Change ONLY the prose. Do NOT change LaTeX commands, \cite{...}, \ref{...}, \label{...}, \\(...\\), $...$, or environment delimiters.
- Do NOT add new LaTeX commands or structural elements.
- Do NOT wrap the output in quotes, backticks, or code fences.
- Return plain text only.`;
    }

    // Call AI provider
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return NextResponse.json({ error: 'AI provider not configured', replacementText: null, explanation: '' }, { status: 503 });
    }

    const releaseSlot = await acquireAiSlot(userId, 'paraphrase');
    if (!releaseSlot) return NextResponse.json({ error: 'AI request already in progress' }, { status: 429, headers: { 'Retry-After': '1' } });
    let aiResponse: Response;
    try {
      aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Runes AI',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: isMarkdown
            ? 'You are a Markdown-aware text editor assistant. Return only the replacement text. Keep every @@PROTECTED_N__ token exactly as-is, verbatim, exactly once. Never add Markdown syntax, raw HTML, or URLs.'
            : 'You are a LaTeX-aware text editor assistant. Return only the replacement text without any markdown, explanations, or formatting.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(15_000),
      });
    } finally {
      await releaseSlot();
    }

    if (!aiResponse.ok) {
      console.error('[AI_PARAPHRASE] Provider status:', aiResponse.status);
      return NextResponse.json({ error: 'AI service error', replacementText: null, explanation: '' }, { status: 502 });
    }

    const aiData = await aiResponse.json();
    const rawText: unknown = aiData?.choices?.[0]?.message?.content;

    // Validate response
    if (typeof rawText !== 'string' || !rawText.trim()) {
      return NextResponse.json({ error: 'Empty AI response', replacementText: null, explanation: '' }, { status: 502 });
    }

    // Check for no-op
    if (rawText === maskedSelection) {
      return NextResponse.json({ replacementText: null, explanation: 'No change suggested', noop: true }, { status: 200 });
    }

    // Validate against dangerous content
    // Check response isn't drastically different in size
    if (rawText.length > Math.min(12_000, selectedText.length * 5 + 100)) {
      return NextResponse.json({ error: 'AI response too large', replacementText: null, explanation: '' }, { status: 422 });
    }

    const restored = isMarkdown
      ? verifyMarkdownRestore(rawText, protectedTokens)
      : verifyAndRestore(maskedSelection, rawText, protectedTokens);
    if (!restored.success) {
      return NextResponse.json({ error: isMarkdown ? 'AI response changed protected Markdown' : 'AI response changed protected LaTeX' }, { status: 422 });
    }
    if (restored.restored === selectedText) {
      return NextResponse.json({ replacementText: null, explanation: 'No change suggested', noop: true });
    }

    return NextResponse.json({
      replacementText: restored.restored,
      explanation: null,
      noop: false,
    }, { status: 200 });

  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return NextResponse.json({ error: 'AI request timed out', replacementText: null, explanation: '' }, { status: 504 });
    }
    console.error('[AI_PARAPHRASE] Request failed');
    return NextResponse.json({ error: 'Internal server error', replacementText: null, explanation: '' }, { status: 500 });
  }
});
