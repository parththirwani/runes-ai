"use client";

import { ArrowRight } from './icons';
import Link from 'next/link';
import { buttonClass } from './Button';
import StartWritingLink from '../landing/startWritingLink';
import Logo from '../brand/logo';
import { SIGN_IN_PATH } from '@/src/lib/paths';

const footerLinks = [
  { label: 'Workflow', href: '#workflow' },
  { label: 'Features', href: '#features' },
];

export default function FinalCta() {
  return (
    <>
      {/* Final CTA band */}
      <section className="section py-24 md:py-32 border-t border-line bg-canvas">
        <div className="section-inner">
          <div className="rounded-xl2 border border-line bg-surface shadow-soft px-6 py-14 md:px-16 md:py-20 text-center">
            <span className="eyebrow">Ready when you are</span>
            <h2 className="mt-4 font-serif text-3xl md:text-5xl tracking-tight text-ink max-w-2xl mx-auto leading-[1.1]">
              Write the document.
              <br />
              <span className="italic">Review AI rewrites.</span>
            </h2>
            <p className="mt-5 text-ink-soft leading-relaxed max-w-narrow mx-auto">
              Start a Markdown or LaTeX document, approve the rewrites you want,
              and compile a PDF from your source.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <StartWritingLink className={buttonClass('primary', 'md')}>
                Start writing
                <ArrowRight className="h-4 w-4" />
              </StartWritingLink>
              <Link href={SIGN_IN_PATH} className={buttonClass('secondary', 'md')}>
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="section overflow-hidden pt-14 pb-4 border-t border-line bg-canvas">
        <div className="section-inner">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <Link href="/" className="inline-flex w-fit items-center text-ink transition-opacity hover:opacity-70" aria-label="Runes AI home">
              <Logo variant="wordmark" size="sm" decorative />
            </Link>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
              {footerLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  className="text-sm font-medium text-ink-soft hover:text-ink transition-colors"
                >
                  {l.label}
                </a>
              ))}
              <Link href={SIGN_IN_PATH} className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">
                Sign in
              </Link>
              <StartWritingLink className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">
                Start writing
              </StartWritingLink>
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-ink-muted">
              © 2026 Runes AI. An editorial writing environment.
            </p>
            <p className="text-xs text-ink-muted">
              Markdown · LaTeX · Diff approval · PDF export
            </p>
          </div>
        </div>
        <div aria-hidden="true" className="select-none pt-12">
          <p className="whitespace-nowrap text-center font-serif text-[clamp(4rem,15vw,13rem)] font-semibold leading-[0.85] tracking-[-0.075em] text-ink/8">
            Runes AI
          </p>
        </div>
      </footer>
    </>
  );
}
