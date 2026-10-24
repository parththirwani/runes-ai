import { cookies } from "next/headers";
import { auth } from "./auth";
import { verifyDevSession } from "./dev-session";

/**
 * Server-side sign-in check for pages. Mirrors withAuth(): either a real
 * NextAuth session or the signed dev-session cookie used by the local bypass.
 */
export async function isSignedIn(): Promise<boolean> {
  try {
    const session = await auth();
    if (session?.user?.email || session?.user?.id) return true;
  } catch {
    // A broken auth configuration must never take public pages down.
  }

  if (process.env.NODE_ENV !== "development") return false;

  const store = await cookies();
  return (await verifyDevSession(store.get("dev-session")?.value)) !== null;
}
