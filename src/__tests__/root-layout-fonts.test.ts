import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `@theme` in globals.css emits `--font-sans` / `--font-mono` on `:root` and they
// reference the next/font variables. Those variables therefore have to be declared
// on `<html>`: when they live on `<body>`, `:root` cannot resolve them, the token
// becomes invalid at computed-value time, and every `font-sans` / `font-mono`
// utility silently falls back to the inherited (serif) font.
describe('root layout font variables', () => {
  const source = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

  it('declares the next/font variables on <html>', () => {
    const htmlTag = source.match(/<html\s[^>]*>/)?.[0] ?? '';

    expect(htmlTag).toContain('geistSans.variable');
    expect(htmlTag).toContain('geistMono.variable');
  });

  it('does not declare them again on <body>', () => {
    const bodyTag = source.match(/<body[^>]*>/)?.[0] ?? '';

    expect(bodyTag).toContain('font-sans');
    expect(bodyTag).not.toContain('.variable');
  });
});
