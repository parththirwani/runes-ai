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
  await signIn("google", { redirectTo: destination });
}
