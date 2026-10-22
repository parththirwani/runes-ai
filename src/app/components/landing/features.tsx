"use client";

import Image from "next/image";
import { GitCompareArrows, Lock, ListTree, ScanText, Sparkles, Type } from "lucide-react";
import Reveal from "./reveal";

const GUARANTEES = [
  "Citations, refs, inline math, display blocks and verbatim environments are masked before the model sees the selection.",
  "The reply is rejected unless every masked token comes back exactly once, in the same order.",
  "Accept applies a single undoable edit; Reject leaves the source as it was.",
];

const SUPPORTING = [
  {
    icon: ListTree,
    title: "An outline built from your headings",
    body: "The sidebar tree is parsed from the \\section and \\subsection commands in the current file, so jumping to a heading is one click.",
    span: "lg:col-span-7",
  },
  {
    icon: Type,
    title: "Ghost-text completion you can silence",
    body: "Prose continuations appear as ghost text after a pause. Tab accepts, and the AI toggle turns completions off for the session.",
    span: "lg:col-span-5",
  },
  {
    icon: ScanText,
    title: "Compile, read, download",
    body: "Save sends the source to the compile worker. The preview tells you when the PDF is older than the text you are looking at.",
    span: "lg:col-span-5",
  },
  {
    icon: Sparkles,
    title: "Three tones, one selection",
    body: "Ask for Clearer, Shorter or Formal prose over the paragraph you highlighted, then compare it in the review panel.",
    span: "lg:col-span-7",
  },
];

export default function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-b border-border-subtle py-20 lg:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            What the editor does
          </p>
          <h2 className="mt-4 text-3xl font-semibold text-foreground md:text-4xl">
            One capability, done carefully
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Runes AI does not rewrite your document in the background. It offers
            prose edits over a selection, shows you the difference, and gets out
            of the way of the LaTeX.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
              <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                <GitCompareArrows className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">AI workspace</span>
                <span className="ml-auto font-mono text-xs text-meta">panel · captured in-app</span>
              </div>
              <Image
                src="/product/ai-workspace.png"
                alt="The Runes AI workspace panel showing AI status, the paraphrase tone controls and the autocomplete toggle."
                width={1400}
                height={900}
                sizes="(min-width: 1024px) 780px, 100vw"
                className="block h-auto w-full"
              />
            </div>
          </Reveal>

          <Reveal delay={0.06} className="lg:col-span-5">
            <h3 className="flex items-start gap-2 text-xl font-semibold text-foreground">
              <Lock className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>AI edits prose, never your markup</span>
            </h3>
            <ul className="mt-5 space-y-4">
              {GUARANTEES.map((item) => (
                <li key={item} className="border-l border-border pl-4 text-sm leading-relaxed text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-10 border-t border-border-subtle pt-12 lg:grid-cols-12">
          {SUPPORTING.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.04} className={item.span}>
              <h3 className="flex items-center gap-2.5 text-base font-semibold text-foreground">
                <item.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {item.title}
              </h3>
              <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
