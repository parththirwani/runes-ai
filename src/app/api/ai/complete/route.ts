import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { prisma } from '@/src/lib/db';
import { z } from 'zod';
import { acquireAiSlot, checkAiRateLimit } from '@/src/lib/ai-rate-limit';
import { filterCompletion } from '@/src/lib/latex-utils';

const completeSchema = z.object({
  documentId: z.string().min(1).max(128),
  prefix: z.string().max(2_000),
  suffix: z.string().max(1_000),
  requestId: z.string().max(128).optional(),
});

export const POST = withAuth(async (req, session) => {
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

    // Ownership check
    const doc = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { id: true },
    });
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Don't suggest for empty prefix
    if (!prefix || prefix.trim().length === 0) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }

    // Call AI
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return NextResponse.json({ insertion: null, error: 'AI completion unavailable' }, { status: 503 });
    }

    const lastLine = prefix.split('\n').pop() || '';
    // Only suggest for text that's part of prose — rough heuristic
    if (/^\\/.test(lastLine.trim()) || /\$\s*$/.test(lastLine.trim())) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }

    const prompt = `Complete the following LaTeX prose with a short continuation (at most one phrase or sentence, roughly 3-30 words). Return ONLY the completion text — no explanations, no markdown, no quotes.

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

    const releaseSlot = await acquireAiSlot(userId, 'complete');
    if (!releaseSlot) return NextResponse.json({ insertion: null }, { status: 429, headers: { 'Retry-After': '1' } });
    let aiResponse: Response;
    try {
      aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a LaTeX writing assistant. Complete the user\'s text with a short prose continuation. Return only the completion text.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(10_000),
      });
    } finally {
      await releaseSlot();
    }

    if (!aiResponse.ok) {
      console.error('[AI_COMPLETE] Provider error:', aiResponse.status);
      return NextResponse.json({ insertion: null, error: 'AI completion unavailable' }, { status: 502 });
    }

    const aiData = await aiResponse.json();
    const insertion: unknown = aiData?.choices?.[0]?.message?.content;

    // Filter
    if (typeof insertion !== 'string' || !filterCompletion(insertion, prefix).accepted) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }

    return NextResponse.json({ insertion }, { status: 200 });

  } catch (error: unknown) {
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
