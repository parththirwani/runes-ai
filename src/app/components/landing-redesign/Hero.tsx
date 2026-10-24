"use client";

import { ArrowRight, Sparkle, Check, Pencil } from './icons';
import { buttonClass } from './Button';
import Badge from './Badge';
import StartWritingLink from '../landing/startWritingLink';

export default function Hero() {
  return (
    <section id="top" className="section pt-16 md:pt-20 pb-16 md:pb-24">
      <div className="section-inner">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Copy */}
          <div className="lg:col-span-5">
            <Badge tone="action" dot>
              Markdown and LaTeX writing
            </Badge>
            <h1 className="mt-5 font-serif text-4xl sm:text-5xl lg:text-[3.25rem] leading-[1.08] tracking-tight text-ink">
              Write the document.
              <br />
              <span className="italic">Review AI rewrites.</span>
            </h1>
            <p className="mt-5 text-base md:text-lg leading-relaxed text-ink-soft max-w-narrow">
              Draft in Markdown or LaTeX. Request a prose rewrite, inspect the diff,
              and accept or reject it before compiling your PDF.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <StartWritingLink className={buttonClass('primary', 'md')}>
                Start writing
                <ArrowRight className="h-4 w-4" />
              </StartWritingLink>
              <a
                href="#workflow"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink transition-colors min-h-[44px] px-2"
              >
                See the workflow
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Product view illustration */}
          <div className="lg:col-span-7">
            <ProductView />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Honest HTML/CSS illustration of the Runes editor showing source text
 * alongside a review panel. Labeled as an illustration.
 */
function ProductView() {
  return (
    <figure className="relative">
      <div className="absolute inset-x-6 -top-4 h-24 bg-gradient-to-b from-line/40 to-transparent rounded-full blur-2xl opacity-60 pointer-events-none" aria-hidden />
      <div className="relative rounded-xl2 border border-line bg-surface shadow-soft overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-line bg-canvas/60">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </div>
          <div className="ml-3 flex items-center gap-2 text-xs text-ink-muted">
            <Pencil className="h-3 w-3" />
            <span className="font-mono">introduction.md</span>
          </div>
          <div className="ml-auto">
            <Badge tone="saved" dot>
              Saved
            </Badge>
          </div>
        </div>

        {/* Editor body */}
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {/* Source pane */}
          <div className="border-b sm:border-b-0 sm:border-r border-line p-5 bg-surface">
            <div className="flex items-center justify-between mb-3">
              <span className="text-eyebrow font-medium uppercase text-ink-muted">
                Source
              </span>
              <span className="text-xs text-ink-muted font-mono">Markdown</span>
            </div>
            <div className="font-mono text-[13px] leading-relaxed text-code-text space-y-1.5">
              <div className="text-ink-muted"># Introduction</div>
              <div>&nbsp;</div>
              <div>
                Attention mechanisms have become a
                <span className="relative bg-action-soft text-action rounded px-1 mx-0.5 ring-1 ring-action/30">
                  central building block
                </span>
                in modern neural architectures.
              </div>
              <div>
                The self-attention operator scales
                <span className="line-through decoration-ink-muted/60">
                  poorly with longer sequence lengths
                </span>
                , which limits its use on long documents.
              </div>
              <div className="text-ink-muted">## Motivation</div>
              <div>Recent work explores linear approximations.</div>
            </div>
          </div>

          {/* Review pane */}
          <div className="p-5 bg-canvas/40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-eyebrow font-medium uppercase text-ink-muted flex items-center gap-1.5">
                <Sparkle className="h-3.5 w-3.5 text-action" />
                AI suggestion
              </span>
              <Badge tone="neutral">1 edit</Badge>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface p-3">
                <div className="text-xs font-medium text-ink-muted mb-1.5">
                  Reword for precision
                </div>
                <div className="font-serif text-sm leading-relaxed space-y-1">
                  <div className="flex gap-2 items-start">
                    <span className="mt-0.5 shrink-0 rounded bg-status-errorSoft text-status-error text-[10px] font-semibold uppercase px-1.5 py-0.5">
                      Removed
                    </span>
                    <span className="line-through decoration-status-error/60 text-ink-muted">
                      scales poorly with longer sequence lengths
                    </span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="mt-0.5 shrink-0 rounded bg-status-savedSoft text-status-saved text-[10px] font-semibold uppercase px-1.5 py-0.5">
                      Added
                    </span>
                    <span className="text-ink">
                      scales quadratically with sequence length
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-action text-white text-xs font-medium px-3 py-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </span>
                  <span className="rounded-md border border-line text-ink-soft text-xs font-medium px-3 py-1.5">
                    Reject
                  </span>
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                Rejecting leaves your source unchanged. Nothing is applied without your approval.
              </p>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-ink-muted">
        Illustration of a Runes rewrite review
      </figcaption>
    </figure>
  );
}
