"use client";

import Reveal from "./reveal";

const STEPS = [
  {
    number: "01",
    title: "Sign in with Google",
    body: "One provider, no card. Your first document list is empty and waiting.",
  },
  {
    number: "02",
    title: "Write in the editor",
    body: "Type LaTeX in Monaco. Prose completions appear as ghost text and only land when you press Tab.",
  },
  {
    number: "03",
    title: "Review, compile, export",
    body: "Ask for a prose edit, read the diff, accept or reject it, then compile and download the PDF.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-b border-border-subtle py-20 lg:py-28">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-5 lg:grid-cols-12 lg:px-8">
        <Reveal className="lg:col-span-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            How it works
          </p>
          <h2 className="mt-4 text-3xl font-semibold text-foreground md:text-4xl">
            Three steps, start to PDF
          </h2>
          <p className="mt-4 max-w-[38ch] text-sm leading-relaxed text-muted-foreground">
            No import wizard and no template gallery. You open a document, write,
            and compile.
          </p>
        </Reveal>

        <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border lg:col-span-8">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.05}>
              <li className="flex h-full items-start gap-4 bg-surface px-5 py-6 md:px-7 md:py-8">
                <span className="mt-0.5 font-mono text-sm text-primary" aria-hidden="true">
                  {step.number}
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
