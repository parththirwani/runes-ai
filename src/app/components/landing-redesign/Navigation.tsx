"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Menu, Close } from './icons';
import { buttonClass } from './Button';
import StartWritingLink from '../landing/startWritingLink';
import Logo from '../brand/logo';
import { SIGN_IN_PATH } from '@/src/lib/paths';

const navLinks = [
  { label: 'Workflow', href: '#workflow' },
  { label: 'Features', href: '#features' },
];

export default function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/95 backdrop-blur-md">
      <nav className="mx-auto w-full max-w-content px-6 md:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Wordmark */}
          <Link href="/" className="inline-flex items-center text-ink transition-opacity hover:opacity-70" aria-label="Runes AI home">
            <Logo variant="wordmark" size="sm" decorative />
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-ink-soft hover:text-ink transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            <Link href={SIGN_IN_PATH} className={buttonClass('ghost', 'sm')}>
              Sign in
            </Link>
            <StartWritingLink className={buttonClass('primary', 'sm')}>
              Start writing
            </StartWritingLink>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-canvas transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="redesign-mobile-menu"
          >
            {menuOpen ? <Close className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div id="redesign-mobile-menu" className="md:hidden pb-4 border-t border-line -mx-6 px-6 pt-3 bg-canvas">
            <div className="flex flex-col gap-1">
              {navLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-ink-soft hover:text-ink hover:bg-surface transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </a>
              ))}
              <div className="flex flex-col gap-2 pt-3 mt-2 border-t border-line">
                <Link href={SIGN_IN_PATH} className={buttonClass('secondary', 'md')}>
                  Sign in
                </Link>
                <StartWritingLink className={buttonClass('primary', 'md')}>
                  Start writing
                </StartWritingLink>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
