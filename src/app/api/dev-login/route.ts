import { NextRequest, NextResponse } from "next/server";
import { signDevSession } from "@/src/lib/dev-session";
import { normalizeEmail } from "@/src/lib/email";
import { ensureDefaultPersonalWorkspace } from "@/src/lib/workspace-ownership";

// Development-only sign-in for local smoke and multi-user browser checks.
//
// Gated three ways: NODE_ENV must be development, DEV_AUTH_BYPASS must be 1, and the request
// must arrive at a loopback hostname. It signs the same HMAC cookie the withAuth helper
// verifies, so it cannot be forged without the server secret.
//
// With ?email=... it switches between accounts, which is what the five-user workspace checks
// need. A new account is only created for a reserved test domain (.test, .invalid, .example,
// or localhost) unless the address is listed in DEV_LOGIN_EMAILS; anything else must already
// exist, so a misconfigured dev server cannot mint arbitrary accounts.

const RESERVED_TEST_DOMAINS = [".test", ".invalid", ".example", "localhost"];

function allowlist(): string[] {
  return (process.env.DEV_LOGIN_EMAILS || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter((value) => value.length > 0);
}

function mayCreateAccount(email: string): boolean {
  if (allowlist().includes(email)) return true;
  const domain = email.slice(email.lastIndexOf("@"));
  return RESERVED_TEST_DOMAINS.some((suffix) => domain.endsWith(suffix));
}

async function handleDevLogin(req: NextRequest) {
  const loopback = ["localhost", "127.0.0.1"].includes(req.nextUrl.hostname);
  if (process.env.NODE_ENV !== "development" || process.env.DEV_AUTH_BYPASS !== "1" || !loopback) {
    return NextResponse.json({ error: "Only available in development" }, { status: 403 });
  }

  const { prisma } = await import("@/src/lib/db");

  const requested = normalizeEmail(
    req.nextUrl.searchParams.get("email") ?? (await req.json().then((body) => (body as { email?: string } | null)?.email).catch(() => null)),
  );

  let user = requested
    ? await prisma.user.findUnique({ where: { email: requested } })
    : await prisma.user.findUnique({ where: { email: "dev@runes-ai.test" } });

  if (!user && requested && mayCreateAccount(requested)) {
    user = await prisma.user.create({
      data: {
        email: requested,
        firstName: requested.split("@")[0],
        lastName: "Dev",
      },
    });
  }

  if (!user) {
    return NextResponse.json({ error: "No such account for development sign-in" }, { status: 404 });
  }

  // Same invariant the sign-in callback maintains: exactly one default personal workspace.
  await ensureDefaultPersonalWorkspace(prisma, user.id);

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
  const host = req.headers.get("host") || req.nextUrl.host;
  const redirect = NextResponse.redirect(new URL("/document", `http://${host}`), { status: 302 });
  const cookie = res.cookies.get("dev-session");
  if (cookie) redirect.cookies.set(cookie);
  return redirect;
}
