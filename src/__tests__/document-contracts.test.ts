import { describe, expect, it } from 'vitest';
import { createDocumentSchema, updateDocumentSchema } from '@/src/schema/documentSchema';
import { latexTemplate, markdownTemplate } from '@/src/lib/templates';
import { plainTextExcerpt } from '@/src/lib/excerpt';

describe('document API contracts', () => {
  it('accepts each format and rejects invalid values', () => {
    expect(createDocumentSchema.safeParse({ title: 'Doc', format: 'MARKDOWN' }).success).toBe(true);
    expect(createDocumentSchema.safeParse({ title: 'Doc', format: 'LATEX' }).success).toBe(true);
    expect(createDocumentSchema.safeParse({ title: 'Doc' }).success).toBe(true); // documented legacy default
    expect(createDocumentSchema.safeParse({ title: 'Doc', format: 'RST' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ title: 'Doc', format: 'markdown' }).success).toBe(false);
  });

  it('rejects oversized content and bad titles', () => {
    expect(createDocumentSchema.safeParse({ title: 'Doc', content: 'x'.repeat(2_000_000) }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ title: '', content: 'x' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ title: 'way too long'.repeat(10), content: 'x' }).success).toBe(false);
  });

  it('makes format immutable through update routes', () => {
    expect(updateDocumentSchema.safeParse({ title: 'Renamed' }).success).toBe(true);
    expect(updateDocumentSchema.safeParse({ content: 'x' }).success).toBe(true);
    expect(updateDocumentSchema.safeParse({ format: 'MARKDOWN' }).success).toBe(false);
    expect(updateDocumentSchema.safeParse({ title: 'x', format: 'LATEX' }).success).toBe(false);
  });
});

describe('creation templates', () => {
  it('LaTeX template compiles as TeX source; Markdown template has no TeX preamble', () => {
    const tex = latexTemplate('My Doc');
    expect(tex).toContain('\\documentclass{article}');
    expect(tex).toContain('\\title{My Doc}');
    const md = markdownTemplate('My Doc');
    expect(md.startsWith('# My Doc')).toBe(true);
    expect(md).not.toContain('\\documentclass');
    expect(md).not.toContain('\\begin{document}');
  });
});

describe('plainTextExcerpt', () => {
  it('strips LaTeX commands without leaking raw TeX', () => {
    const excerpt = plainTextExcerpt(
      '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nHello \\textbf{world} and \\cite{key2024}.\n\\end{document}',
      'LATEX',
    );
    expect(excerpt).toContain('Introduction');
    expect(excerpt).toContain('Hello');
    expect(excerpt).toContain('world');
    expect(excerpt).not.toContain('documentclass');
    expect(excerpt).not.toContain('\\');
    expect(excerpt).not.toContain('{');
  });

  it('strips Markdown syntax, fences, and HTML', () => {
    const excerpt = plainTextExcerpt(
      '# Title\n\nProse with **bold**, `code`, [a link](https://x.com), and <script>alert(1)</script>.\n\n```js\nsecret = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |',
      'MARKDOWN',
    );
    expect(excerpt).toContain('Title');
    expect(excerpt).toContain('bold');
    expect(excerpt).toContain('a link');
    expect(excerpt).not.toContain('#');
    expect(excerpt).not.toContain('**');
    expect(excerpt).not.toContain('`');
    expect(excerpt).not.toContain('<');
    expect(excerpt).not.toContain('script');
    expect(excerpt).not.toContain('secret');
    expect(excerpt).not.toContain('|');
  });

  it('bounds excerpt length', () => {
    const excerpt = plainTextExcerpt('word '.repeat(500), 'MARKDOWN');
    expect(excerpt.length).toBeLessThanOrEqual(95);
  });
});
