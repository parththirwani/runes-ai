import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GhostTextStatusChip from '@/src/app/components/editor/GhostTextStatusChip';

const idle = () => undefined;

function render(props: Partial<React.ComponentProps<typeof GhostTextStatusChip>> = {}) {
  return renderToStaticMarkup(
    <GhostTextStatusChip
      phase="idle"
      modelName={null}
      announcement={null}
      onAccept={idle}
      onRetry={idle}
      {...props}
    />,
  );
}

describe('GhostTextStatusChip markup', () => {
  it('is tagged with the phase and carries a text label in every state', () => {
    for (const phase of ['idle', 'thinking', 'ready', 'accepted', 'none', 'unavailable'] as const) {
      const html = render({ phase, modelName: 'openrouter · openai/gpt-4o-mini' });
      expect(html).toContain(`data-phase="${phase}"`);
      // A text label always exists (state is never colour alone).
      expect(html).toMatch(/<span>[^<]+<\/span>/);
    }
  });

  it('names the real reported model when idle', () => {
    const html = render({ phase: 'idle', modelName: 'openrouter · openai/gpt-4o-mini' });
    expect(html).toContain('openrouter · openai/gpt-4o-mini');
  });

  it('shows the thinking dot only while thinking and hides it from screen readers', () => {
    expect(render({ phase: 'thinking' })).toContain('ghost-text-thinking');
    expect(render({ phase: 'thinking' })).toContain('aria-hidden="true"');
    expect(render({ phase: 'ready' })).not.toContain('ghost-text-thinking');
  });

  it('offers a tap-to-accept control only while a suggestion is visible', () => {
    expect(render({ phase: 'ready' })).toContain('ghost-text-accept');
    expect(render({ phase: 'ready' })).toContain('Accept AI suggestion');
    expect(render({ phase: 'idle' })).not.toContain('ghost-text-accept');
    expect(render({ phase: 'accepted' })).not.toContain('ghost-text-accept');
  });

  it('offers Retry only after a retryable failure', () => {
    expect(render({ phase: 'unavailable' })).toContain('ghost-text-retry');
    expect(render({ phase: 'unavailable' })).toContain('Retry AI completion');
    expect(render({ phase: 'none' })).not.toContain('ghost-text-retry');
    expect(render({ phase: 'ready' })).not.toContain('ghost-text-retry');
  });

  it('keeps Accept out of the tab order while making Retry keyboard reachable', () => {
    const accept = render({ phase: 'ready' });
    expect(accept).toContain('tabindex="-1"');
    const retry = render({ phase: 'unavailable' });
    expect(retry).not.toContain('tabindex="-1"');
  });

  it('announces through one polite live region', () => {
    const html = render({ phase: 'ready', announcement: 'AI suggestion ready — press Tab to accept' });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('AI suggestion ready — press Tab to accept');
  });

  it('drops animation under reduced motion', () => {
    const html = render({ phase: 'thinking' });
    expect(html).toContain('motion-reduce:transition-none');
    expect(html).toContain('motion-reduce:animate-none');
  });
});
