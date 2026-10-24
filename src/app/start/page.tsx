"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import Logo from "../components/brand/logo";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
import SignOutButton from "../components/auth/SignOutButton";
import { buttonClass } from "../components/landing-redesign/Button";
import { createDocumentPath, SIGN_IN_PATH, type CreateFormat } from "@/src/lib/paths";
import "../landing-redesign.css";

const formats: {
  id: CreateFormat;
  title: string;
  extension: string;
  description: string;
  sample: string;
}[] = [
  {
    id: "MARKDOWN",
    title: "Markdown",
    extension: ".md",
    description: "For notes, reports, and technical writing with a reading preview.",
    sample: "# A clear first draft\n\nStart with the idea. Shape the details later.",
  },
  {
    id: "LATEX",
    title: "LaTeX",
    extension: ".tex",
    description: "For papers, citations, equations, and precise typesetting.",
    sample: "\\section{Introduction}\n\nA useful result begins with a clear question.",
  },
];

export default function StartPage() {
  const [format, setFormat] = useState<CreateFormat>("MARKDOWN");
  const { status } = useSession();
  const destination = createDocumentPath(format);

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

      <div className="mx-auto grid w-full max-w-content flex-1 gap-12 px-6 py-16 md:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-20 lg:py-24">
        <div className="max-w-md">
          <span className="eyebrow">New document</span>
          <h1 className="mt-5 font-serif text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]">
            Start with the format that fits.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-ink-soft md:text-lg">
            Choose your source format now. Next, name the document with the right editor and PDF pipeline ready.
          </p>
          <Link href={SIGN_IN_PATH} className="mt-8 inline-flex min-h-11 items-center text-sm font-medium text-action transition-colors hover:text-action-hover hover:underline">
            Have documents already? Sign in
          </Link>
        </div>

        <section aria-labelledby="format-heading" className="w-full rounded-xl2 border border-line bg-surface p-6 shadow-soft sm:p-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="eyebrow">Choose your canvas</span>
              <h2 id="format-heading" className="mt-3 font-serif text-2xl text-ink sm:text-3xl">What are you writing in?</h2>
            </div>
            <span className="hidden font-mono text-xs text-ink-muted sm:block">01 / 02</span>
          </div>

          <div className="mt-6 grid gap-3">
            {formats.map((choice) => {
              const selected = format === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFormat(choice.id)}
                  className={`w-full rounded-xl border p-5 text-left transition-colors ${selected ? "border-action bg-action-soft" : "border-line bg-canvas/40 hover:border-line-strong"}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-serif text-lg font-semibold text-ink">{choice.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-muted">{choice.extension}</span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-action bg-action text-white" : "border-line-strong bg-surface"}`}>
                        {selected && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                    </span>
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{choice.description}</span>
                  <code className="mt-4 block whitespace-pre-wrap rounded-lg border border-code-border bg-code-bg p-3 font-mono text-xs leading-relaxed text-code-text">{choice.sample}</code>
                </button>
              );
            })}
          </div>

          <div className="mt-6 border-t border-line pt-6">
            {status === "authenticated" ? (
              <Link href={destination} className={buttonClass("primary", "md", "w-full")}>
                Continue to document setup
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : status === "loading" ? (
              <button type="button" disabled className={buttonClass("primary", "md", "w-full opacity-60")}>
                Checking sign-in…
              </button>
            ) : (
              <GoogleSignInButton redirectTo={destination} label="Continue with Google" />
            )}
            <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
              No document is created until you choose a title.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-line px-6 py-5 text-xs text-ink-muted md:px-8">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Runes AI</span>
          <span>Markdown · LaTeX · PDF</span>
        </div>
      </footer>
    </main>
  );
}
