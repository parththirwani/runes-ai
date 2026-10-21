"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import Logo from "../components/brand/logo";
import { Button } from "../components/ui/button";
import { handleGoogleSignIn } from "../actions";
import { DOCUMENTS_PATH, resolveRedirect } from "@/src/lib/paths";

const AFTER_SIGN_IN = [
  "A document workspace where you can create, search and delete drafts",
  "The Monaco editor with an outline built from your own headings",
  "AI prose suggestions that you approve in a diff before they are applied",
];

function SignInCard() {
  const searchParams = useSearchParams();
  const next = resolveRedirect(searchParams.get("next"), DOCUMENTS_PATH);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await handleGoogleSignIn(next);
      } catch {
        setError("Google sign-in could not start. Check your connection and try again.");
      }
    });
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl border border-border bg-surface p-7 shadow-panel md:p-9">
        <Logo variant="wordmark" size="md" />

        <h1 className="mt-7 text-2xl font-semibold text-foreground">Sign in to Runes AI</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We use Google to identify you, then send you straight to your documents.
        </p>

        <Button
          type="button"
          size="lg"
          onClick={handleSubmit}
          disabled={isPending}
          className="mt-7 w-full"
        >
          {isPending ? "Opening Google…" : "Continue with Google"}
        </Button>

        {error && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-8 border-t border-border-subtle pt-6">
          <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-meta">
            What you get
          </h2>
          <ul className="mt-3 space-y-2">
            {AFTER_SIGN_IN.map((item) => (
              <li key={item} className="border-l border-border pl-3 text-sm leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-meta">
        Only your name, email and profile photo are requested.
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main id="main" className="relative flex min-h-dvh items-center justify-center overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-pattern opacity-40" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/10 blur-[110px]"
      />
      <div className="relative px-5 py-16">
        <Suspense fallback={null}>
          <SignInCard />
        </Suspense>
      </div>
    </main>
  );
}
