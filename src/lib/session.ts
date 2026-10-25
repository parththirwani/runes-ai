// One answer to "who is asking", shared by route handlers and server rendered pages.
//
// Production identity is the NextAuth session. The development bypass signs its own HMAC
// cookie (see src/lib/dev-session.ts), and both readers below accept it, so a page and the API
// behind it can never disagree about who is signed in. The identity is re-read from the
// database, never trusted from the cookie, which is what keeps a hand-edited token worthless.

import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "./auth";
import { prisma } from "./db";
import { verifyDevSession } from "./dev-session";

function fromDatabaseUser(user: { id: string; email: string; firstName: string | null; lastName: string | null }): Session {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

/** The signed-in account, or null. Never throws: an unreadable session is simply no session. */
export async function resolveSession(): Promise<Session | null> {
  const session = await auth().catch(() => null);
  if (session?.user?.id) return session;
  if (process.env.NODE_ENV !== "development") return session ?? null;

  try {
    const payload = await verifyDevSession((await cookies()).get("dev-session")?.value);
    if (!payload) return session ?? null;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    return user ? fromDatabaseUser(user) : session ?? null;
  } catch {
    return session ?? null;
  }
}
