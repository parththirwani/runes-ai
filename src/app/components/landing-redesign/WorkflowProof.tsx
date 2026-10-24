"use client";

import { useState, type ComponentType, type SVGProps } from 'react';
import { Check, Close, CursorSelect, Document, Sparkle, ArrowRight } from './icons';
import Button from './Button';
import Badge from './Badge';

type Step = 0 | 1 | 2;
type Decision = 'pending' | 'accepted' | 'rejected';

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const steps: { id: Step; label: string; icon: IconType; desc: string }[] = [
  { id: 0, label: 'Select', icon: CursorSelect, desc: 'Highlight the prose you want improved.' },
  { id: 1, label: 'Review', icon: Sparkle, desc: 'Inspect the diff, then accept or reject.' },
  { id: 2, label: 'Export', icon: Document, desc: 'Compile a PDF after you accept a rewrite.' },
];

export default function WorkflowProof() {
  const [step, setStep] = useState<Step>(0);
  const [decision, setDecision] = useState<Decision>('pending');
  const [compiled, setCompiled] = useState(false);

  const goTo = (s: Step) => {
    setStep(s);
    if (s === 0) {
      setDecision('pending');
      setCompiled(false);
    }
  };

  return (
    <section id="workflow" className="section py-20 md:py-28 border-t border-line">
      <div className="section-inner">
        {/* Heading */}
        <div className="max-w-narrow">
          <span className="eyebrow">The workflow</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl tracking-tight text-ink">
            Three states. One short document.
          </h2>
          <p className="mt-4 text-ink-soft leading-relaxed">
            Select prose, request a rewrite, and inspect the diff before accepting
            it. Then compile a PDF from the source you approved. Try the example below.
          </p>
        </div>

        {/* Step selector */}
        <div className="mt-10 flex flex-wrap items-center gap-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <button
                  onClick={() => goTo(s.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    active
                      ? 'bg-ink text-canvas'
                      : 'bg-surface border border-line text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                  aria-pressed={active}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-canvas/20' : 'bg-canvas text-ink-muted'}`}>
                    {i + 1}
                  </span>
                  <Icon className="h-4 w-4" />
                  {s.label}
                </button>
                {i < steps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-line-strong shrink-0 hidden sm:block" />
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-sm text-ink-muted min-h-[1.5rem]">
          {steps[step].desc}
        </p>

        {/* Stage */}
        <div className="mt-6 rounded-xl2 border border-line bg-surface shadow-lift overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-line bg-canvas/60">
            <span className="font-mono text-xs text-ink-muted">attention.md</span>
            <div className="ml-auto flex items-center gap-2">
              {step === 0 && <Badge tone="unsaved" dot>Editing</Badge>}
              {step === 1 && <Badge tone="action" dot>Suggestion ready</Badge>}
              {step === 2 && <Badge tone={decision === 'accepted' && !compiled ? 'stale' : 'saved'} dot>{decision === 'accepted' && !compiled ? 'Needs compile' : 'Up to date'}</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Source / diff pane */}
            <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-line">
              <SourcePane step={step} decision={decision} />
            </div>

            {/* Review / PDF pane */}
            <div className="p-6 md:p-8 bg-canvas/40">
              {step === 0 && <StepReviewIntro onNext={() => goTo(1)} />}
              {step === 1 && (
                <StepReviewDiff
                  decision={decision}
                  onAccept={() => { setDecision('accepted'); setCompiled(false); }}
                  onReject={() => { setDecision('rejected'); setCompiled(false); }}
                  onNext={() => goTo(2)}
                />
              )}
              {step === 2 && <StepPdfPreview decision={decision} compiled={compiled} onCompile={() => setCompiled(true)} />}
            </div>
          </div>
        </div>

        {/* Footnote */}
        <p className="mt-4 text-sm text-ink-muted max-w-narrow">
          This is an illustrative workflow. The controls change this example only.
          Rejecting a suggestion leaves the source unchanged.
        </p>
      </div>
    </section>
  );
}

/* ---- Source pane content per step ---- */
function SourcePane({ step, decision }: { step: Step; decision: Decision }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-eyebrow font-medium uppercase text-ink-muted">Source</span>
        <span className="text-xs text-ink-muted font-mono">Markdown</span>
      </div>
      <div className="font-mono text-[13px] leading-relaxed text-code-text space-y-2">
        <div className="text-ink-muted"># Attention at scale</div>
        <div>&nbsp;</div>
        <div>
          The self-attention operator{' '}
          {step === 0 ? (
            <span className="relative bg-action-soft text-action rounded px-1 ring-1 ring-action/30 cursor-pointer">
              scales poorly with longer sequence lengths
            </span>
          ) : decision === 'accepted' ? (
            <span className="bg-status-savedSoft text-status-saved rounded px-1">
              scales quadratically with sequence length
            </span>
          ) : (
            <span>
              scales poorly with longer sequence lengths
            </span>
          )}
          , which limits its use on long documents.
        </div>
        <div className="text-ink-muted">## Motivation</div>
        <div>Recent work explores linear approximations that retain fidelity.</div>
      </div>
    </div>
  );
}

/* ---- Step 0: review intro ---- */
function StepReviewIntro({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-start h-full">
      <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-ink-muted mb-4">
        <CursorSelect className="h-3.5 w-3.5" />
        Step 1: Select
      </div>
      <p className="font-serif text-lg leading-relaxed text-ink">
        You highlight the phrase you want the AI to reconsider. The selected text is
        shown highlighted in the source pane.
      </p>
      <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-canvas p-4 w-full">
        <div className="text-xs text-ink-muted mb-2">Selected text</div>
        <p className="font-mono text-sm text-ink">
          scales poorly with longer sequence lengths
        </p>
      </div>
      <Button variant="secondary" size="md" className="mt-6" onClick={onNext}>
        Move to review
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ---- Step 1: diff review ---- */
function StepReviewDiff({
  decision,
  onAccept,
  onReject,
  onNext,
}: {
  decision: Decision;
  onAccept: () => void;
  onReject: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-ink-muted mb-4">
        <Sparkle className="h-3.5 w-3.5 text-action" />
        Step 2: Review
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="text-xs font-medium text-ink-muted mb-2">Reword for precision</div>
        <div className="font-serif text-sm leading-relaxed space-y-2">
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
            <span className="text-ink">scales quadratically with sequence length</span>
          </div>
        </div>
      </div>

      {decision === 'pending' ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onAccept}
            className="inline-flex items-center gap-1 rounded-lg bg-action text-white text-sm font-medium px-4 py-2.5 hover:bg-action-hover transition-colors min-h-[44px]"
          >
            <Check className="h-4 w-4" />
            Accept
          </button>
          <button
            onClick={onReject}
            className="inline-flex items-center gap-1 rounded-lg border border-line text-ink-soft text-sm font-medium px-4 py-2.5 hover:bg-canvas transition-colors min-h-[44px]"
          >
            <Close className="h-4 w-4" />
            Reject
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className={`inline-flex items-center gap-2 rounded-lg text-sm font-medium px-3 py-2 ${decision === 'accepted' ? 'bg-status-savedSoft text-status-saved' : 'bg-canvas text-ink-soft'}`}>
            {decision === 'accepted' ? <Check className="h-4 w-4" /> : <Close className="h-4 w-4" />}
            {decision === 'accepted' ? 'Edit applied to source' : 'Suggestion rejected'}
          </div>
          <Button variant="primary" size="md" onClick={onNext}>
            See the PDF
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---- Step 2: PDF preview ---- */
function StepPdfPreview({ decision, compiled, onCompile }: { decision: Decision; compiled: boolean; onCompile: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-ink-muted mb-4">
        <Document className="h-3.5 w-3.5" />
        Step 3: Export
      </div>
      <div className="rounded-lg border border-line bg-surface shadow-paper p-6 min-h-[260px]">
        {/* Mock page */}
        <div className="border-l-2 border-line pl-4">
          <div className="font-serif text-lg font-semibold text-ink mb-2">
            Attention at scale
          </div>
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            The self-attention operator{' '}
            {decision === 'accepted' && compiled ? (
              <span className="text-ink font-medium">
                scales quadratically with sequence length
              </span>
            ) : (
              <span>
                scales poorly with longer sequence lengths
              </span>
            )}
            , which limits its use on long documents.
          </p>
          <div className="mt-3 font-serif text-sm font-semibold text-ink">Motivation</div>
          <p className="font-serif text-sm leading-relaxed text-ink-soft mt-1">
            Recent work explores linear approximations that retain fidelity.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between">
          {decision === 'accepted' && !compiled ? (
            <Badge tone="stale" dot>PDF needs compile</Badge>
          ) : (
            <Badge tone="saved" dot>PDF up to date</Badge>
          )}
          <span className="text-xs text-ink-muted">Example preview</span>
        </div>
        {decision === 'accepted' && !compiled && (
          <Button variant="primary" size="md" className="mt-5" onClick={onCompile}>
            Compile example PDF
          </Button>
        )}
      </div>
    </div>
  );
}
