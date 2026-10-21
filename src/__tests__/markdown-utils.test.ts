import { describe, expect, it } from 'vitest';
import {
  analyzeMarkdownSelection,
  filterMarkdownCompletion,
  markdownLineIsProse,
  scanMarkdownContext,
  verifyMarkdownRestore,
} from '@/src/lib/markdown-utils';

describe('scanMarkdownContext', () => {
  it('detects fenced code by offset', () => {
    const src = '# Title\n\n```js\nconst x = 1;\n```\n\nprose here';
    const inFence = scanMarkdownContext(src, src.indexOf('const x'));
    expect(inFence.isInFencedCode).toBe(true);
    expect(inFence.inProtected).toBe(true);
    const outside = scanMarkdownContext(src, src.indexOf('prose here'));
    expect(outside.inProtected).toBe(false);
  });

  it('detects inline code, math, and link destinations', () => {
    const src = 'before `code span` mid $x^2$ end [label](https://ex.com) and ![](images/a.png)';
    expect(scanMarkdownContext(src, src.indexOf('code span')).isInInlineCode).toBe(true);
    expect(scanMarkdownContext(src, src.indexOf('x^2')).isInMath).toBe(true);
    const linkDest = scanMarkdownContext(src, src.indexOf('https://ex.com'));
    expect(linkDest.isInLinkDestination).toBe(true);
    const imageDest = scanMarkdownContext(src, src.indexOf('images/a.png'));
    expect(imageDest.isInImageUrl).toBe(true);
  });

  it('detects front matter, tables, raw HTML, headings, and list markers', () => {
    const fm = '---\ntitle: x\n---\nBody';
    expect(scanMarkdownContext(fm, 8).isInFrontMatter).toBe(true);
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(scanMarkdownContext(table, 14).isInTableDelimiter).toBe(true);
    expect(scanMarkdownContext('text <script>alert(1)</script>', 8).isInRawHtml).toBe(true);
    expect(scanMarkdownContext('## ', 3).isInHeadingMarker).toBe(true);
    expect(scanMarkdownContext('- ', 2).isInListMarker).toBe(true);
    expect(scanMarkdownContext('[ref]: ', 7).isInReferenceDefinition).toBe(true);
  });

  it('does not treat autolinks as raw HTML', () => {
    const ctx = scanMarkdownContext('see <https://example.com> for info', 12);
    expect(ctx.isInRawHtml).toBe(false);
  });
});

describe('analyzeMarkdownSelection', () => {
  const at = (src: string, needle: string) => scanMarkdownContext(src, src.indexOf(needle));

  it('masks links, inline code, math, images, and emphasis as protected tokens', () => {
    const src = 'plain prose only';
    const selection = 'See `code` and $x^2$ and [a link](https://ex.com) plus ![img](images/a.png) and **bold**.';
    const analysis = analyzeMarkdownSelection(selection, at(src, 'plain'));
    expect(analysis.eligible).toBe(true);
    expect(analysis.protectedTokens.length).toBe(5);
    expect(analysis.maskedSelection).not.toContain('https://ex.com');
    expect(analysis.maskedSelection).not.toContain('code');
  });

  it('rejects selections in protected contexts', () => {
    const inFence = scanMarkdownContext('```\nselection here\n```', 8);
    expect(analyzeMarkdownSelection('selection here', inFence).eligible).toBe(false);
    const inMath = scanMarkdownContext('before $x^2$ after', 9);
    expect(analyzeMarkdownSelection('x^2', inMath).eligible).toBe(false);
  });

  it('rejects structural lines so markers cannot change', () => {
    const src = 'prose outside';
    expect(analyzeMarkdownSelection('# Heading text', at(src, 'prose')).eligible).toBe(false);
    expect(analyzeMarkdownSelection('- list item', at(src, 'prose')).eligible).toBe(false);
    expect(analyzeMarkdownSelection('| a | b |', at(src, 'prose')).eligible).toBe(false);
    expect(analyzeMarkdownSelection('a <b>tag</b> here', at(src, 'prose')).eligible).toBe(false);
  });

  it('requires prose beyond protected tokens', () => {
    const analysis = analyzeMarkdownSelection('`only code` $and$ **math**', at('prose', 'prose'));
    expect(analysis.eligible).toBe(false);
  });
});

describe('verifyMarkdownRestore', () => {
  it('restores protected tokens only when each appears exactly once, in any sentence order', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '`code`' },
      { placeholder: '@@PROTECTED_1__', original: '[link](https://ex.com)' },
    ];
    const ok = verifyMarkdownRestore('Reworded @@PROTECTED_0__ and @@PROTECTED_1__ text.', tokens);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.restored).toBe('Reworded `code` and [link](https://ex.com) text.');

    const missing = verifyMarkdownRestore('Reworded @@PROTECTED_0__ text.', tokens);
    expect(missing.success).toBe(false);

    const swapped = verifyMarkdownRestore('A @@PROTECTED_1__ B @@PROTECTED_0__', tokens);
    expect(swapped.success).toBe(true);

    const extra = verifyMarkdownRestore('A @@PROTECTED_0__ @@PROTECTED_0__ @@PROTECTED_1__', tokens);
    expect(extra.success).toBe(false);

    const unknown = verifyMarkdownRestore('A @@PROTECTED_0__ @@PROTECTED_7__', tokens);
    expect(unknown.success).toBe(false);
  });

  it('refuses responses that introduce raw HTML, Markdown syntax, or URLs', () => {
    const tokens = [{ placeholder: '@@PROTECTED_0__', original: '$x$' }];
    expect(verifyMarkdownRestore('has <b>html</b> @@PROTECTED_0__', tokens).success).toBe(false);
    expect(verifyMarkdownRestore('has `backticks` @@PROTECTED_0__', tokens).success).toBe(false);
    expect(verifyMarkdownRestore('has [text](http://evil) @@PROTECTED_0__', tokens).success).toBe(false);
    expect(verifyMarkdownRestore('link to www.evil.com @@PROTECTED_0__', tokens).success).toBe(false);
  });
});

describe('filterMarkdownCompletion', () => {
  it('accepts short prose and rejects syntax, URLs, and repetition', () => {
    expect(filterMarkdownCompletion(' and further results.', 'Some prose end').accepted).toBe(true);
    expect(filterMarkdownCompletion('- new bullet', 'Some prose').accepted).toBe(false);
    expect(filterMarkdownCompletion('a [link](x)', 'prefix').accepted).toBe(false);
    expect(filterMarkdownCompletion('run `cmd` now', 'prefix').accepted).toBe(false);
    expect(filterMarkdownCompletion('## A heading', 'prefix').accepted).toBe(false);
    expect(filterMarkdownCompletion('see https://evil.example', 'prefix').accepted).toBe(false);
    expect(filterMarkdownCompletion('Some prose end again', 'Some prose end').accepted).toBe(false);
    expect(filterMarkdownCompletion('ab', 'prefix').accepted).toBe(false);
  });

  it('markdownLineIsProse suppresses structural lines', () => {
    expect(markdownLineIsProse('plain prose ')).toBe(true);
    expect(markdownLineIsProse('# ')).toBe(false);
    expect(markdownLineIsProse('- ')).toBe(false);
    expect(markdownLineIsProse('> ')).toBe(false);
    expect(markdownLineIsProse('```')).toBe(false);
    expect(markdownLineIsProse('|---|')).toBe(false);
  });
});
