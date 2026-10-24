import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownPreview from '@/src/app/components/editor/MarkdownPreview';

describe('MarkdownPreview code blocks', () => {
  it('renders fenced code in a styled preformatted block', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview source={'Before\n\n```js\nconst answer = 42;\n```\n\nAfter'} />
    );

    expect(html).toMatch(/<pre[^>]*class="[^"]*\bbg-code-bg\b[^"]*"[^>]*>/);
    expect(html).toContain('<code class="language-js">const answer = 42;');
    expect(html).toContain('</code></pre>');
  });
});
