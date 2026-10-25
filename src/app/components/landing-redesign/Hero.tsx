"use client";

import { ArrowRight } from './icons';
import { buttonClass } from './Button';
import StartWritingLink from '../landing/startWritingLink';
import { DoodleCallout } from '../ui/doodle-callout';

export default function Hero() {
  return (
    <section id="top" className="section border-b border-line bg-canvas py-24 md:py-32">
      <div className="section-inner">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Markdown and LaTeX writing</p>
          <h1 className="mx-auto mt-5 max-w-3xl font-serif text-5xl leading-[1.04] tracking-tight text-ink sm:text-6xl md:text-7xl">
            Write with clarity.
            <br />
            <span className="italic">Keep your voice.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-soft md:text-lg">
            Draft in Markdown or LaTeX, review AI suggestions as diffs, and compile a polished PDF from your source.
          </p>
          <div className="mt-8 flex justify-center">
            <StartWritingLink className={buttonClass('primary', 'md')}>
              Start writing
              <ArrowRight className="h-4 w-4" />
            </StartWritingLink>
          </div>
          <DoodleCallout
            label="review first"
            width={220}
            height={48}
            strokeWidth={3.5}
            revealGap={350}
            loopInterval={9000}
            className="mx-auto mt-8"
            labelClassName="text-sm md:text-base"
            strokeClassName="opacity-75"
          />
          <p className="mt-10 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-ink-muted">
            Markdown · LaTeX · Diff approval · PDF export
          </p>
        </div>
      </div>
    </section>
  );
}
