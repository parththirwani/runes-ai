import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { prisma } from '@/src/lib/db';
import { z } from 'zod';

// Rate limiter for AI endpoints — simplified per-user sliding window
const AI_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const AI_RATE_LIMIT_MAX = 20;

const rateLimitMap = new Map<string, number[]>();

function checkAiRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowStart = now - AI_RATE_LIMIT_WINDOW_MS;
  const entries = rateLimitMap.get(userId) || [];
  const recent = entries.filter((t: number) => t > windowStart);
  rateLimitMap.set(userId, recent);
  const remaining = Math.max(0, AI_RATE_LIMIT_MAX - recent.length);
  if (recent.length >= AI_RATE_LIMIT_MAX) {
    const resetAt = (recent[0] || now) + AI_RATE_LIMIT_WINDOW_MS;
    return { allowed: false, remaining: 0, resetAt };
  }
  recent.push(now);
  return { allowed: true, remaining, resetAt: now + AI_RATE_LIMIT_WINDOW_MS };
}

const paraphraseSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  selectedText: z.string().min(1, 'selectedText is required').max(10_000),
  before: z.string().max(3_000).default(''),
  after: z.string().max(3_000).default(''),
  tone: z.enum(['Clearer', 'Shorter', 'Formal']).default('Clearer'),
  requestId: z.string().optional(),
});

export const POST = withAuth(async (req, session) => {
  try {
    const body = await req.json();
    const parsed = paraphraseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { documentId, selectedText, before, after, tone } = parsed.data;
    const userId = session.user.id;

    // Rate limit check (Redis fallback if offline)
    const rl = checkAiRateLimit(userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, {
        status: 429,
        headers: { 'X-RateLimit-Reset': rl.resetAt.toString(), 'Retry-After': Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
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

    // Build prompt
    const toneInstruction = {
      Clearer: 'Make the selected text clearer and more readable while preserving its meaning and LaTeX structure.',
      Shorter: 'Make the selected text more concise and shorter while preserving its meaning and LaTeX structure.',
      Formal: 'Make the selected text more formal and academic in tone while preserving its meaning and LaTeX structure.',
    }[tone];

    const prompt = `You are paraphrasing selected prose from a LaTeX document. Return ONLY the replacement text — no explanations, no markdown fences, no JSON. 

${toneInstruction}

Selected text to paraphrase:
"""${selectedText}"""

Context before the selection:
"""${before}"""

Context after the selection:
"""${after}"""

Rules:
- Change ONLY the prose. Do NOT change LaTeX commands, \cite{...}, \ref{...}, \label{...}, \\(...\\), $...$, or environment delimiters.
- Do NOT add new LaTeX commands or structural elements.
- Do NOT wrap the output in quotes, backticks, or code fences.
- Return plain text only.`;

    // Call AI provider
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return NextResponse.json({ error: 'AI provider not configured', replacementText: null, explanation: '' }, { status: 503 });
    }

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
          { role: 'system', content: 'You are a LaTeX-aware text editor assistant. Return only the replacement text without any markdown, explanations, or formatting.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => 'Unknown AI error');
      console.error('[AI_PARAPHRASE] Provider error:', aiResponse.status, errText.slice(0, 200));
      return NextResponse.json({ error: 'AI service error', replacementText: null, explanation: '' }, { status: 502 });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData?.choices?.[0]?.message?.content?.trim() || '';

    // Validate response
    if (!rawText) {
      return NextResponse.json({ error: 'Empty AI response', replacementText: null, explanation: '' }, { status: 502 });
    }

    // Check for no-op
    if (rawText === selectedText.trim()) {
      return NextResponse.json({ replacementText: null, explanation: 'No change suggested', noop: true }, { status: 200 });
    }

    // Validate against dangerous content
    if (/\\documentclass|\\begin\{document\}|\\end\{document\}|\\input\{|\\include\{|\\usepackage\{/.test(rawText)) {
      return NextResponse.json({ error: 'AI response contains invalid LaTeX structure commands', replacementText: null, explanation: '' }, { status: 422 });
    }

    // Check response isn't drastically different in size
    if (rawText.length > selectedText.length * 5) {
      return NextResponse.json({ error: 'AI response too large', replacementText: null, explanation: '' }, { status: 422 });
    }

    return NextResponse.json({
      replacementText: rawText,
      explanation: null,
      noop: false,
    }, { status: 200 });

  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return NextResponse.json({ error: 'AI request timed out', replacementText: null, explanation: '' }, { status: 504 });
    }
    console.error('[AI_PARAPHRASE] Error:', error?.message || error);
    return NextResponse.json({ error: 'Internal server error', replacementText: null, explanation: '' }, { status: 500 });
  }
});