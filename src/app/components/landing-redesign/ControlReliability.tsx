import { Shield, Lock, Undo, DocWarn, Check, Pencil } from './icons';
import Badge from './Badge';

const controls = [
  {
    icon: Lock,
    title: 'Syntax-aware rewrites',
    desc: 'Prose rewrites preserve citations, references, commands, and math in the selected text. Invalid AI replies are rejected.',
  },
  {
    icon: Shield,
    title: 'Explicit diff approval',
    desc: 'Requested prose rewrites show Added and Removed text. Your source changes only when you accept the suggestion.',
  },
  {
    icon: Undo,
    title: 'Undo an accepted edit',
    desc: 'An accepted rewrite is one undoable source edit. Rejecting a suggestion leaves the source untouched.',
  },
  {
    icon: DocWarn,
    title: 'Visible stale PDF',
    desc: 'When the source changes, the PDF preview is marked stale until you compile it again.',
  },
];

const states: { tone: 'saved' | 'unsaved' | 'compiling' | 'stale' | 'error'; label: string }[] = [
  { tone: 'saved', label: 'Saved' },
  { tone: 'unsaved', label: 'Unsaved' },
  { tone: 'compiling', label: 'Compiling' },
  { tone: 'stale', label: 'Stale PDF' },
  { tone: 'error', label: 'Error' },
];

export default function ControlReliability() {
  return (
    <section className="section py-20 md:py-28 border-t border-line bg-canvas">
      <div className="section-inner">
        <div className="max-w-narrow">
          <span className="eyebrow">Control and reliability</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl tracking-tight text-ink">
            You stay in charge of the document.
          </h2>
          <p className="mt-4 text-ink-soft leading-relaxed">
            Requested rewrites remain suggestions until you accept them. Syntax
            protection, diff approval, undo, and PDF status help you keep track of
            what changed in the source and what has been compiled.
          </p>
        </div>

        {/* Control cards */}
        <div className="mt-10 grid sm:grid-cols-2 gap-5">
          {controls.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="rounded-xl2 border border-line bg-surface p-6 shadow-paper hover:shadow-lift transition-shadow duration-200 ease-smooth"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-action-soft text-action mb-4">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-lg font-semibold text-ink mb-1.5">
                  {c.title}
                </h3>
                <p className="text-sm text-ink-soft leading-relaxed">{c.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Status states strip */}
        <div className="mt-10 rounded-xl2 border border-line bg-surface p-6 md:p-8 shadow-paper">
          <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-10">
            <div className="md:w-1/3">
              <h3 className="font-serif text-lg font-semibold text-ink mb-1.5">
                Status at a glance
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                These status indicators show when edits are saved and when the PDF
                needs to be compiled again.
              </p>
            </div>
            <div className="flex-1 flex flex-wrap gap-3">
              {states.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <Badge tone={s.tone} dot>
                    {s.label}
                  </Badge>
                  <span className="text-xs text-ink-muted hidden sm:inline">
                    {s.tone === 'saved' && 'All changes written to disk'}
                    {s.tone === 'unsaved' && 'Edits not yet saved'}
                    {s.tone === 'compiling' && 'PDF building now'}
                    {s.tone === 'stale' && 'Source changed; PDF out of date'}
                    {s.tone === 'error' && 'Compile failed; see the log'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Mini status bar mock */}
          <div className="mt-6 rounded-lg border border-line bg-canvas/60 px-4 py-3 flex items-center gap-3 text-xs text-ink-muted">
            <Pencil className="h-3.5 w-3.5" />
            <span className="font-mono">attention.md</span>
            <span className="text-line-strong">·</span>
            <Check className="h-3.5 w-3.5 text-status-saved" />
            <span>Saved 2s ago</span>
            <span className="text-line-strong">·</span>
            <span className="text-status-stale">PDF stale</span>
            <span className="text-line-strong">·</span>
            <span>Markdown source</span>
          </div>
        </div>
      </div>
    </section>
  );
}
