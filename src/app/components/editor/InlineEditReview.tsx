'use client';

// Per-change review card for AI inline edit. The hunk model itself is pure and
// lives in src/lib/inline-edit-hunks.ts; the keyboard rules and labels live in
// src/lib/inline-edit-review.ts. This component only renders that model and
// reports decisions — it never touches the Monaco model. Applying the
// assembled replacement is the controller (DocumentEditor) job, after it
// rechecks document id, model URI, model version and the original bytes.

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Button from '../design/Button';
import { computeDiff } from '@/src/lib/proposal-engine';
import { reviewActionForKey, summarizeReview, reviewAnnouncement, type InlineEditKeySignal } from '@/src/lib/inline-edit-review';
import type { InlineEditHunkModel } from '@/src/lib/inline-edit-hunks';
import { InlineEditDiffText } from './InlineEditCard';

const CARD_CLASS = 'rounded-lg border border-border bg-surface shadow-overlay text-foreground';

export interface InlineEditReviewCardProps {
  model: InlineEditHunkModel;
  focusIndex: number | null;
  onFocusChange: (index: number | null) => void;
  onDecision: (hunkId: string, decision: 'accepted' | 'rejected') => void;
  onApply: () => void;
  onDismiss: () => void;
  /** Set when the anchor is no longer exact: every action becomes inert. */
  staleReason?: string | null;
  commandLabel?: string;
}

export default function InlineEditReviewCard({
  model,
  focusIndex,
  onFocusChange,
  onDecision,
  onApply,
  onDismiss,
  staleReason = null,
  commandLabel = 'Ctrl',
}: InlineEditReviewCardProps) {
  const summary = summarizeReview(model);
  const tokens = computeDiff(model.originalText, model.replacementText);
  const decisions = model.hunks.map((hunk) => hunk.decision);
  const focused = focusIndex !== null && focusIndex >= 0 && focusIndex < model.hunks.length
    ? model.hunks[focusIndex]
    : null;
  const blocked = staleReason ?? summary.blockedReason;
  const canAct = !staleReason;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const signal: InlineEditKeySignal = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    const action = reviewActionForKey(signal, focused !== null && canAct);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action.type) {
      case 'rejectFocused':
        if (focused) onDecision(focused.id, 'rejected');
        break;
      case 'apply':
        if (summary.canApply && canAct) onApply();
        break;
    }
  };

  return (
    <div
      className={`${CARD_CLASS} w-[min(26rem,calc(100vw-2rem))] overflow-hidden`}
      role="region"
      aria-label="Review AI changes"
      tabIndex={-1}
      data-inline-edit-review=""
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Review changes</span>
          <span className="text-[11px] text-meta tabular-nums" role="status">{summary.total} {summary.total === 1 ? 'change' : 'changes'}</span>
        </div>
        <button type="button" onClick={onDismiss} title="Dismiss (Esc)" className="rounded p-1 text-meta hover:bg-surface-raised hover:text-foreground" aria-label="Dismiss review without changing the source">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-2 px-3 pb-3 pt-2">
        <p className="sr-only">Removed text is struck through. Added text is underlined.</p>
        <div className="max-h-44 overflow-y-auto rounded-md bg-canvas p-2.5">
          <InlineEditDiffText
            tokens={tokens}
            decisions={decisions}
            focusOrdinal={focusIndex}
            onFocusChange={(ordinal) => onFocusChange(ordinal)}
            onToggleChange={(ordinal) => {
              const hunk = model.hunks[ordinal];
              if (hunk && canAct) onDecision(hunk.id, hunk.decision === 'rejected' ? 'accepted' : 'rejected');
            }}
            totalChanges={summary.total}
          />
        </div>

        <p className="text-[11px] text-meta">
          {focused
            ? 'Change ' + (focused.ordinal + 1) + ' of ' + summary.total + ' — ' + (focused.decision === 'rejected' ? 'original kept' : 'suggestion selected')
            : 'Click a highlighted change to keep its original wording'}
        </p>

        {blocked && (staleReason || !summary.canApply) && (
          <p className={staleReason
            ? 'flex items-start gap-1 rounded-md border border-warning/30 bg-warning-subtle px-2 py-1 text-[11px] text-warning'
            : 'text-[11px] text-meta'}>
            {staleReason && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
            <span>{blocked}</span>
          </p>
        )}
        <p className="sr-only text-[11px]" role="status" aria-live="polite">{reviewAnnouncement(summary)}</p>
      </div>

      <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!summary.canApply || !canAct}
            onClick={onApply}
            aria-label={summary.applyLabel === 'Keep original' ? 'Keep original text' : 'Accept changes'}
            title={blocked ?? `Accept the selected changes (${commandLabel}+Enter)`}
          >
            {summary.applyLabel === 'Keep original' ? 'Keep original' : 'Accept changes'}
          </Button>
      </div>
    </div>
  );
}
