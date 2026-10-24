"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Logo from "../components/brand/logo";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
import SignOutButton from "../components/auth/SignOutButton";
import { DOCUMENTS_PATH, resolveRedirect } from "@/src/lib/paths";
import "../landing-redesign.css";

function SignInCard() {
  const searchParams = useSearchParams();
  const next = resolveRedirect(searchParams.get("next"), DOCUMENTS_PATH);
  const serviceUnavailable = searchParams.get("error") === "service-unavailable";
  return (
    <section aria-labelledby="signin-heading" className="w-full rounded-xl2 border border-line bg-surface p-7 shadow-soft sm:p-9">
      <span className="eyebrow">Your account</span>
      <h2 id="signin-heading" className="mt-4 font-serif text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Continue to your documents.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Sign in with Google to open your Runes workspace.
      </p>

      {serviceUnavailable && (
        <p role="alert" className="mt-5 rounded-lg bg-status-errorSoft px-4 py-3 text-sm leading-relaxed text-status-error">
          Runes could not reach the document service. Please try signing in again in a moment.
        </p>
      )}

      <div className="mt-8">
        <GoogleSignInButton redirectTo={next} />
      </div>

      <p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-ink-muted">
        Google shares your name, email address, and profile photo with Runes for sign-in.
      </p>
    </section>
  );
}

export default function SignInPage() {
  return (
    <main id="main" className="landing-redesign flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-6 md:px-8">
          <Link href="/" className="inline-flex items-center text-ink transition-opacity hover:opacity-70" aria-label="Runes AI home">
            <Logo variant="wordmark" size="sm" decorative />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
            <SignOutButton className="text-ink-soft hover:bg-surface hover:text-ink" />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-content flex-1 items-center gap-12 px-6 py-16 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:gap-20 lg:py-24">
        <div className="max-w-xl">
          <span className="eyebrow">The Runes workspace</span>
          <h1 className="mt-5 font-serif text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]">
            Stay close to the words.
            <br />
            <span className="italic">Keep control of the edits.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-ink-soft md:text-lg">
            Return to your Markdown and LaTeX drafts. Review AI prose rewrites in a diff, then compile the source you approve into a PDF.
          </p>
          <div className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-5 font-mono text-xs text-ink-muted">
            <span>Markdown</span>
            <span aria-hidden="true">/</span>
            <span>LaTeX</span>
            <span aria-hidden="true">/</span>
            <span>Diff review</span>
            <span aria-hidden="true">/</span>
            <span>PDF</span>
          </div>
        </div>

        <Suspense fallback={<div className="w-full rounded-xl2 border border-line bg-surface p-9 text-sm text-ink-muted shadow-soft">Loading sign-in…</div>}>
          <SignInCard />
        </Suspense>
      </div>

      <footer className="border-t border-line px-6 py-5 text-xs text-ink-muted md:px-8">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Runes AI</span>
          <span>Write the document. Review the change.</span>
        </div>
      </footer>
    </main>
  );
}
