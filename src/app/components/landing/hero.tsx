"use client";

import Image from "next/image";
import { Check, FileCode2, GitCompareArrows, FileDown } from "lucide-react";
import { Button } from "../ui/button";
import Link from "next/link";
import Logo from "../brand/logo";
import Reveal from "./reveal";
import StartWritingLink from "./startWritingLink";
import { HOW_IT_WORKS_ANCHOR } from "@/src/lib/paths";

const FACTS = [
  { icon: FileCode2, label: "Monaco LaTeX editor" },
  { icon: GitCompareArrows, label: "Diff review before edits land" },
  { icon: FileDown, label: "PDF compile and download" },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle pt-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-pattern opacity-60" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-[120px]"
      />

      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-5 pb-16 pt-14 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="lg:col-span-6">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              LaTeX workspace
            </p>
          </Reveal>

          <Reveal delay={0.04}>
            <h1 className="mt-4 max-w-[15ch] text-4xl font-semibold leading-[1.08] text-foreground md:text-5xl">
              Write LaTeX with reviewed AI edits
            </h1>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-muted-foreground md:text-lg">
              A Monaco source editor, AI prose edits you approve in a diff, and PDF
              compilation in the same window.
            </p>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <StartWritingLink>
                <Button size="lg" className="w-full shadow-accent sm:w-auto">
                  Start writing
                </Button>
              </StartWritingLink>
              <Link href={HOW_IT_WORKS_ANCHOR}>
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  See how it works
                </Button>
              </Link>
            </div>
          </Reveal>

        </div>

        <Reveal delay={0.1} className="lg:col-span-6">
          <figure className="overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-raised/60 px-4 py-2.5">
              <Logo variant="mark" size="sm" decorative />
              <span className="truncate font-mono text-xs text-muted-foreground">
                revamp-demo-paper.tex
              </span>
              <span className="ml-auto flex items-center gap-1.5 rounded-full bg-primary-subtle px-2 py-0.5 text-xs text-primary">
                <Check className="h-3 w-3" aria-hidden="true" />
                compiled
              </span>
            </div>
            <Image
              src="/product/editor-split.png"
              alt="The Runes AI editor showing LaTeX source on the left and the compiled PDF preview on the right."
              width={1400}
              height={900}
              priority
              sizes="(min-width: 1024px) 720px, 100vw"
              className="block h-auto w-full border-t border-border-subtle"
            />
            <figcaption className="border-t border-border-subtle px-4 py-3 text-xs text-meta">
              Source and PDF preview in one view. Screenshot captured from this app.
            </figcaption>
          </figure>
        </Reveal>
      </div>

      <div className="relative border-t border-border-subtle">
        <Reveal>
          <ul aria-label="What the editor does" className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-5 py-5 lg:px-8">
            {FACTS.map((fact) => (
              <li key={fact.label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <fact.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {fact.label}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
