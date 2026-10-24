"use client";

import { ArrowLeft, House } from "lucide-react";
import Link from "next/link";
import { Button } from "./components/ui/button";
import StartWritingLink from "./components/landing/startWritingLink";
import { FEATURES_ANCHOR, SIGN_IN_PATH } from "@/src/lib/paths";

const NotFound = () => {
  return (
    <main id="main" className="relative flex min-h-dvh items-center bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-6 py-20 lg:px-8">
        <p className="font-mono text-sm text-action">404</p>
        <h1 className="mt-3 font-serif text-[28px] font-semibold tracking-tight text-foreground md:text-[32px] md:leading-[38px]">
          That page is not in this document
        </h1>

        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-surface shadow-paper">
          <div className="border-b border-border bg-surface-raised px-4 py-2 font-mono text-xs text-meta">
            latex.out
          </div>
          <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-sm leading-relaxed text-code-text">
            <code>
              <span className="text-destructive">! LaTeX Error: File `requested-page` not found.</span>
              {"\n"}
              {"\n"}! Emergency stop.
            </code>
          </pre>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/">
            <Button size="lg" className="w-full sm:w-auto">
              <House className="h-4 w-4" aria-hidden="true" />
              Go home
            </Button>
          </Link>
          <StartWritingLink>
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              Go to my documents
            </Button>
          </StartWritingLink>
          <Button
            size="lg"
            variant="ghost"
            className="w-full text-muted-foreground hover:text-foreground sm:w-auto"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go back
          </Button>
        </div>

        <nav aria-label="Helpful links" className="mt-12 border-t border-border pt-6">
          <p className="text-sm text-meta">Or jump to:</p>
          <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <li>
              <Link href={FEATURES_ANCHOR} className="text-sm text-action hover:text-action-hover">
                Features
              </Link>
            </li>
            <li>
              <Link href={SIGN_IN_PATH} className="text-sm text-action hover:text-action-hover">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </div>

    </main>
  );
};

export default NotFound;
