"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { buttonClass } from "../landing-redesign/Button";

interface GoogleSignInButtonProps {
  redirectTo: string;
  label?: string;
}

export default function GoogleSignInButton({
  redirectTo,
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setPending(true);
    try {
      await signIn("google", { redirectTo });
    } catch {
      setPending(false);
      setError("Google sign-in could not start. Check your connection and try again.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        className={buttonClass("primary", "md", "w-full gap-3 disabled:cursor-wait disabled:opacity-60")}
      >
        {pending ? "Opening Google…" : label}
        {!pending && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </button>
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-status-errorSoft px-3 py-2.5 text-sm leading-relaxed text-status-error">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </>
  );
}
