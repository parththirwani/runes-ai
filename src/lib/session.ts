import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "./auth";
import { prisma } from "./db";
import { verifyDevSession } from "./dev-session";

function devAuthEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * The local bypass cookie only counts while the user behind it still exists.
 * A deleted row must not keep a visitor "signed in".
 */
async function sessionFromDevCookie(cookie: string | undefined): Promise<Session | null> {
  if (!cookie) return null;

  const payload = await verifyDevSession(cookie);
  if (!payload) return null;

  try {
    const dbUser = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!dbUser) return null;

    return {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim(),
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };
  } catch (error) {
    console.error("[DEV_SESSION_LOOKUP_ERROR]", error);
    return null;
  }
}

/**
 * Single acceptance rule for an authenticated caller. API routes (withAuth) and
 * server pages both go through here, so a page can never welcome a visitor the
 * document API would reject: an identity is only accepted when it carries a user
 * id, and the development identity must still resolve to a database user.
 */
export async function resolveRequestSession(devSessionCookie?: string): Promise<Session | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    // Misconfigured auth is an unauthenticated request, never a public 500.
    console.error("[SESSION_RESOLVE_ERROR]", error);
    return null;
  }

  if (session?.user?.id) return session;
  if (!devAuthEnabled()) return null;

  return sessionFromDevCookie(devSessionCookie);
}

/**
 * Server-component flavour of resolveRequestSession: reads the development
 * cookie from the request store instead of a NextRequest.
 */
export async function resolvePageSession(): Promise<Session | null> {
  let devSessionCookie: string | undefined;
  if (devAuthEnabled()) {
    try {
      devSessionCookie = (await cookies()).get("dev-session")?.value;
    } catch {
      devSessionCookie = undefined;
    }
  }

  return resolveRequestSession(devSessionCookie);
}
