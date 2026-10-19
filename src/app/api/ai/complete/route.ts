import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { prisma } from '@/src/lib/db';
import { z } from 'zod';

const completeSchema = z.object({
  documentId: z.string().min(1),
  prefix: z.string().max(5_000),
  suffix: z.string().max(5_000),
  requestId: z.string().optional(),
});

// In-memory rate limit (same pattern as paraphrase)
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowStart = now - RL_WINDOW_MS;
  const entries = rateLimitMap.get(userId) || [];
  const recent = entries.filter((t: number) => t > windowStart);
  rateLimitMap.set(userId, recent);
  const remaining = Math.max(0, RL_MAX - recent.length);
  if (recent.length >= RL_MAX) {
    const resetAt = (recent[0] || now) + RL_WINDOW_MS;
    return { allowed: false, remaining: 0, resetAt };
  }
  recent.push(now);
  return { allowed: true, remaining, resetAt: now + RL_WINDOW_MS };
}

export const POST = withAuth(async (req, session) => {
  try {
    const body = await req.json();
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { documentId, prefix, suffix } = parsed.data;
    const userId = session.user.id;

    // Rate limit
    const rl = checkRateLimit(userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, {
        status: 429,
        headers: { 'Retry-After': Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
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
      return NextResponse.json({ insertion: null }, { status: 200 }); // quiet failure
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

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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

    if (!aiResponse.ok) {
      console.error('[AI_COMPLETE] Provider error:', aiResponse.status);
      return NextResponse.json({ insertion: null }, { status: 200 }); // quiet failure
    }

    const aiData = await aiResponse.json();
    let insertion = (aiData?.choices?.[0]?.message?.content || '').trim();

    // Filter
    if (!insertion || insertion.length > 200) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }
    if (/\\documentclass|\\begin\{|\\end\{|\\input\{|\\include\{/.test(insertion)) {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }

    return NextResponse.json({ insertion }, { status: 200 });

  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json({ insertion: null }, { status: 200 });
    }
    console.error('[AI_COMPLETE] Error:', error?.message || error);
    return NextResponse.json({ insertion: null }, { status: 200 });
  }
});