import { Outline, Type, BookOpen, Download } from './icons';

const features = [
  {
    icon: Outline,
    title: 'Outline navigation',
    desc: 'Jump to headings and sections from a structured outline when your document gets long.',
  },
  {
    icon: Type,
    title: 'Ghost text completion',
    desc: 'Inline AI completion appears as you type. Press Tab to accept a suggestion, or keep typing to dismiss it.',
  },
  {
    icon: BookOpen,
    title: 'Reading preview',
    desc: 'Switch Markdown documents to a rendered reading view to review prose and structure away from the source.',
  },
  {
    icon: Download,
    title: 'PDF export',
    desc: 'Compile Markdown or LaTeX source into a PDF. If the source changes afterward, the editor marks the PDF as stale.',
  },
];

export default function SecondaryFeatures() {
  return (
    <section id="features" className="section py-20 md:py-28 border-t border-line">
      <div className="section-inner">
        <div className="max-w-narrow">
          <span className="eyebrow">Also built in</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl tracking-tight text-ink">
            Everything around the main loop.
          </h2>
          <p className="mt-4 text-ink-soft leading-relaxed">
            These support the writing, but the review-and-approve loop stays the
            focus. Each feature is quiet by default and there when you need it.
          </p>
        </div>

        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="rounded-xl2 border border-line bg-surface p-5 hover:border-line-strong transition-colors duration-200 ease-smooth"
              >
                <Icon className="h-5 w-5 text-action mb-3" />
                <h3 className="text-sm font-semibold text-ink mb-1.5">{f.title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
