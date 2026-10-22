"use server";
import { signIn } from "@/src/lib/auth";
import { DOCUMENTS_PATH, resolveRedirect } from "@/src/lib/paths";

/**
 * Starts the Google OAuth flow. `redirectTo` is only honoured when it is a
 * same-site absolute path, so a crafted `?next=` can never bounce a user off
 * the app. The default destination is the documents workspace.
 */
export async function handleGoogleSignIn(redirectTo?: unknown) {
  const destination = resolveRedirect(redirectTo, DOCUMENTS_PATH);
  try {
    await signIn("google", { redirectTo: destination });
  } catch (error: unknown) {
    if (error instanceof Error && (error as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
    console.error("[GOOGLE_SIGN_IN_ERROR]", error);
    throw error;
  }
}
