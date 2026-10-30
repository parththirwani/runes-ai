import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewModeToggle from '@/src/app/components/editor/ViewModeToggle';

function render(value: 'editor' | 'split' | 'preview', labels?: { preview?: string }) {
  return renderToStaticMarkup(React.createElement(ViewModeToggle, { value, onChange: () => undefined, labels }));
}

describe('view mode control', () => {
  it('renders one View button instead of three mode buttons', () => {
    const html = render('split');
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-label="View: Split. Change view"');
    expect(html).toContain('>Split<');
  });

  it('names the current view and lets the format rename the reading mode', () => {
    expect(render('editor')).toContain('aria-label="View: Code. Change view"');
    expect(render('preview', { preview: 'Reading' })).toContain('aria-label="View: Reading. Change view"');
  });
});
