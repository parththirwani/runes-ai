import { Hash, Sigma, ArrowRight } from './icons';

export default function FormatChoice() {
  return (
    <section className="section py-20 md:py-28 border-t border-line">
      <div className="section-inner">
        <div className="max-w-narrow">
          <span className="eyebrow">Both formats, one editor</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl tracking-tight text-ink">
            Write in Markdown or LaTeX.
            <br />
            One editor for both formats.
          </h2>
          <p className="mt-4 text-ink-soft leading-relaxed">
            Markdown keeps everyday prose fast and readable for drafts, notes,
            and technical documentation. LaTeX handles equations, citations, and
            publication-grade typography for academic papers and theses. Runes treats
            both as first-class source formats for the same AI review, diff approval,
            and PDF export workflow.
          </p>
        </div>

        <div className="mt-10 grid md:grid-cols-2 gap-5">
          {/* Markdown card */}
          <article className="rounded-xl2 border border-line bg-surface shadow-paper overflow-hidden">
            <div className="flex items-center gap-2 px-5 h-11 border-b border-line bg-canvas/60">
              <Hash className="h-4 w-4 text-action" />
              <span className="text-sm font-medium text-ink">Markdown</span>
              <span className="ml-auto text-xs text-ink-muted font-mono">.md</span>
            </div>
            <div className="p-5">
              <p className="text-sm text-ink-soft mb-4 leading-relaxed">
                Plain-text headings, lists, and emphasis. Best for drafts, notes, and
                any document you want to read easily while writing.
              </p>
              <pre className="rounded-lg bg-code-bg border border-code-border p-4 text-[13px] font-mono leading-relaxed text-code-text overflow-x-auto">
{`# Introduction

Attention mechanisms have become a
**central building block** in modern
neural architectures.

## Motivation
- Linear approximations
- Sparse attention`}
              </pre>
            </div>
          </article>

          {/* LaTeX card */}
          <article className="rounded-xl2 border border-line bg-surface shadow-paper overflow-hidden">
            <div className="flex items-center gap-2 px-5 h-11 border-b border-line bg-canvas/60">
              <Sigma className="h-4 w-4 text-action" />
              <span className="text-sm font-medium text-ink">LaTeX</span>
              <span className="ml-auto text-xs text-ink-muted font-mono">.tex</span>
            </div>
            <div className="p-5">
              <p className="text-sm text-ink-soft mb-4 leading-relaxed">
                Equations, cross-references, and publication-grade typography. Best for
                papers, theses, and anything with formal notation.
              </p>
              <pre className="rounded-lg bg-code-bg border border-code-border p-4 text-[13px] font-mono leading-relaxed text-code-text overflow-x-auto">
{`\\section{Introduction}

Attention mechanisms have become a
\\textbf{central building block}.

\\section{Motivation}
$\\mathcal{O}(n^2)$ complexity.`}
              </pre>
            </div>
          </article>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
          <ArrowRight className="h-4 w-4" />
          <span>Both Markdown and LaTeX feed the same AI review, diff approval, and PDF export pipeline.</span>
        </div>
      </div>
    </section>
  );
}
