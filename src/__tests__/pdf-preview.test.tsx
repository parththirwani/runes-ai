import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PDFPreview from '@/src/app/components/editor/PDFPreview';

describe('PDFPreview', () => {
  it('uses the page renderer without a browser PDF iframe for Markdown', () => {
    const html = renderToStaticMarkup(
      <PDFPreview pdfUrl="blob:https://example.com/document" renderPages />
    );

    expect(html).toContain('Loading PDF preview');
    expect(html).not.toContain('<iframe');
  });
});
