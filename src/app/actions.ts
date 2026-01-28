"use server";
import { signIn } from "@/src/lib/auth";

export async function handleGoogleSignIn() {
  console.log("handleGoogleSignIn called");
  try {
    await signIn("google", { redirectTo: "/" });
  } catch (error: any) {
    // Ignore Next.js redirect "errors" — they are not real failures
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error; // re-throw so Next.js can do the redirect
    }
    // Only log real errors
    console.error("Real sign-in error:", error);
    throw error;
  }
}