import { NextRequest, NextResponse } from "next/server";

// Dev-only auth bypass: create a session cookie for a seeded test user.
// Only active when NODE_ENV=development.
async function handleDevLogin() {
  if (process.env.NODE_ENV !== "development") {
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

  // Set the NEXTAUTH_SECRET so cookie signing is consistent
  const secret = process.env.NEXTAUTH_SECRET || "dev-secret-do-not-use-in-prod";

  // Build a minimal session token as a JWT payload
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    picture: user.image,
  };

  // Encode as base64url JSON for a simple dev cookie (no JWT library needed)
  const b64 = Buffer.from(JSON.stringify(tokenPayload)).toString("base64url");

  // Set both httpOnly (for API calls) and non-httpOnly (for page navigation in headless browser)
  const response = NextResponse.json({ ok: true, user: tokenPayload, slug: user.id });
  response.cookies.set("dev-session", b64, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 86400,
  });
  // Also set a non-httpOnly variant that JS can use to bootstrap
  response.cookies.set("dev-session-readable", b64, {
    httpOnly: false,
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
  const res = await handleDevLogin();
  const origin = req.nextUrl.origin;
  return NextResponse.redirect(new URL("/document/test", origin), { status: 302 });
}