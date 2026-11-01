'use client';

// Ghost text status chip — the compact, always-labelled state indicator from
// docs/ai-inline-edit-plan.md §Ghost text step 4. It names the real provider
// and model the server reported (never a hard-coded demo model), cycles
// idle → Thinking → Tab to accept → Accepted / No suggestion + Retry, accepts
// by tap on touch without stealing editor focus, announces through a polite
// status region, and drops its animation under reduced motion. All state
// decisions live in src/lib/ghost-text.ts; this file is markup.

import React from 'react';
import { ghostChipView, type GhostChipPhase } from '@/src/lib/ghost-text';

export type GhostTextStatusChipProps = {
  phase: GhostChipPhase;
  modelName: string | null;
  announcement: string | null;
  onAccept: () => void;
  onRetry: () => void;
};

export default function GhostTextStatusChip({
  phase, modelName, announcement, onAccept, onRetry,
}: GhostTextStatusChipProps) {
  const view = ghostChipView(phase, modelName);
  // Tap/click accepts whenever a suggestion is visible — the touch path from
  // the plan, and harmless on desktop where Tab does the same thing. The
  // button never steals editor focus (pointerdown is prevented and it stays
  // out of the tab order).
  const acceptByTap = view.acceptable;
  return (
    <span
      data-testid="ghost-text-chip"
      data-phase={phase}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] text-meta transition-colors duration-200 motion-reduce:transition-none motion-reduce:duration-0"
    >
      {phase === 'thinking' && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-status-compiling animate-pulse motion-reduce:animate-none"
          data-testid="ghost-text-thinking"
        />
      )}
      <span>{view.label}</span>
      {acceptByTap && (
        <button
          type="button"
          data-testid="ghost-text-accept"
          aria-label="Accept AI suggestion"
          tabIndex={-1}
          // pointerdown preventDefault keeps focus in the editor; Tab keeps
          // working and the chip never enters the tab order.
          onPointerDown={(event) => event.preventDefault()}
          onClick={onAccept}
          className="rounded-full bg-action px-1.5 py-0.5 text-[10px] text-white"
        >
          Accept
        </button>
      )}
      {view.retryable && (
        <button
          type="button"
          data-testid="ghost-text-retry"
          aria-label="Retry AI completion"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onRetry}
          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-surface-raised"
        >
          Retry
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">{announcement ?? ''}</span>
    </span>
  );
}
