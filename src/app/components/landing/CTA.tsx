"use client";

import { Button } from "../ui/button";
import Reveal from "./reveal";
import StartWritingLink from "./startWritingLink";

export default function CTA() {
  return (
    <section className="py-20 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 lg:px-8">
        <Reveal className="flex flex-col items-start justify-between gap-8 rounded-xl border border-border bg-surface px-6 py-10 shadow-panel md:flex-row md:items-center md:px-10">
          <div>
            <h2 className="text-2xl font-semibold text-foreground md:text-3xl">
              Open a document and try it on a paragraph you already wrote
            </h2>
            <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
              Sign in with Google, create a document and select a sentence in the
              body of it. The AI workspace panel will offer a rewrite for review.
            </p>
          </div>
          <StartWritingLink className="shrink-0">
            <Button size="lg" className="w-full shadow-accent md:w-auto">
              Start writing
            </Button>
          </StartWritingLink>
        </Reveal>
      </div>
    </section>
  );
}
