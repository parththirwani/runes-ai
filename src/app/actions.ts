"use server";
import { signIn } from "@/src/lib/auth";

export async function handleGoogleSignIn() {
  console.log("handleGoogleSignIn called");
  try {
    await signIn("google", { redirectTo: "/" });
  } catch (error: any) {
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error;
    }
    console.error("Real sign-in error:", error);
    throw error;
  }
}