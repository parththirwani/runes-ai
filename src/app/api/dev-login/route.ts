import { NextRequest, NextResponse } from "next/server";
import { signDevSession } from '@/src/lib/dev-session';

// Dev-only auth bypass: create a session cookie for a seeded test user.
// Only active when NODE_ENV=development.
async function handleDevLogin(req: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.DEV_AUTH_BYPASS !== '1' || !['localhost', '127.0.0.1'].includes(req.nextUrl.hostname)) {
    return NextResponse.json({ error: "Only available in development" }, { status: 403 });
  }

  const { prisma } = await import("@/src/lib/db");

  // Find or create the dev test user
  const email = "dev@runes-ai.test";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        firstName: "Dev",
        lastName: "User",
      },
    });
  }

  // The local test session is signed so callers cannot impersonate a user.
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    picture: user.image,
    issuedAt: Date.now(),
  };

  const signed = await signDevSession(tokenPayload);

  const response = NextResponse.json({ ok: true, user: tokenPayload, slug: user.id });
  response.cookies.set("dev-session", signed, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 86400,
  });
  return response;
}

// POST for programmatic login (via fetch/XHR)
export const POST = handleDevLogin;
// GET for direct navigation — redirects to document page after setting cookie
export async function GET(req: NextRequest) {
  const res = await handleDevLogin(req);
  if (!res.ok) return res;
  const host = req.headers.get('host') || req.nextUrl.host;
  const redirect = NextResponse.redirect(new URL('/document', `http://${host}`), { status: 302 });
  const cookie = res.cookies.get('dev-session');
  if (cookie) redirect.cookies.set(cookie);
  return redirect;
}
