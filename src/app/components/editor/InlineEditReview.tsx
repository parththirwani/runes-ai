'use client';

// Per-change review card for AI inline edit. The hunk model itself is pure and
// lives in src/lib/inline-edit-hunks.ts; the keyboard rules and labels live in
// src/lib/inline-edit-review.ts. This component only renders that model and
// reports decisions — it never touches the Monaco model. Applying the
// assembled replacement is the controller (DocumentEditor) job, after it
// rechecks document id, model URI, model version and the original bytes.

import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import Button from '../design/Button';
import { computeDiff } from '@/src/lib/proposal-engine';
import { reviewActionForKey, cycleChangeFocus, summarizeReview, reviewAnnouncement, type InlineEditKeySignal } from '@/src/lib/inline-edit-review';
import type { InlineEditHunkModel } from '@/src/lib/inline-edit-hunks';
import {
  InlineEditDiffLegend,
  InlineEditDiffText,
  Kbd,
} from './InlineEditCard';

const CARD_CLASS = 'rounded-lg border border-border bg-surface shadow-overlay text-foreground';

export interface InlineEditReviewCardProps {
  model: InlineEditHunkModel;
  focusIndex: number | null;
  onFocusChange: (index: number | null) => void;
  onDecision: (hunkId: string, decision: 'accepted' | 'rejected') => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
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
  onAcceptAll,
  onRejectAll,
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
      case 'focusNext':
        onFocusChange(cycleChangeFocus(model.hunks.length, focusIndex, 'next'));
        break;
      case 'focusPrev':
        onFocusChange(cycleChangeFocus(model.hunks.length, focusIndex, 'prev'));
        break;
      case 'acceptFocused':
        if (focused) onDecision(focused.id, 'accepted');
        break;
      case 'rejectFocused':
        if (focused) onDecision(focused.id, 'rejected');
        break;
      case 'acceptRest':
        if (canAct) onAcceptAll();
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
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Review changes
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-meta tabular-nums" role="status">{summary.changesLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-meta">
            <Kbd>esc</Kbd>
            <button type="button" onClick={onDismiss} className="hover:text-foreground" aria-label="Dismiss review without changing the source">
              dismiss
            </button>
          </span>
        </span>
      </div>

      <div className="space-y-2 p-2.5">
        <InlineEditDiffLegend />
        <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-canvas p-2">
          <InlineEditDiffText
            tokens={tokens}
            decisions={decisions}
            focusOrdinal={focusIndex}
            onFocusChange={(ordinal) => onFocusChange(ordinal)}
            totalChanges={summary.total}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {focused
              ? 'Change ' + (focused.ordinal + 1) + ' of ' + summary.total + ' — ' + (focused.decision === 'pending' ? 'no decision yet' : focused.decision)
              : 'Select a change to accept or reject it on its own'}
          </span>
          <span className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={!focused || !canAct}
              onClick={() => focused && onDecision(focused.id, 'rejected')}
              icon={<X className="h-3.5 w-3.5" />}
              aria-label="Reject focused change"
              title={!focused ? 'Focus a change with Tab first' : 'Reject this change and keep the original words'}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!focused || !canAct}
              onClick={() => focused && onDecision(focused.id, 'accepted')}
              icon={<Check className="h-3.5 w-3.5" />}
              aria-label="Accept focused change"
              title={!focused ? 'Focus a change with Tab first' : 'Accept this change'}
            >
              Accept
            </Button>
          </span>
        </div>

        {blocked && (
          <p className="flex items-start gap-1 rounded-md border border-warning/30 bg-warning-subtle px-2 py-1 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{blocked}</span>
          </p>
        )}
        <p className="sr-only text-[11px]" role="status" aria-live="polite">{reviewAnnouncement(summary)}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-raised px-2.5 py-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-meta">
          <span className="flex items-center gap-1"><Kbd>Tab</Kbd><span>through changes</span></span>
          <span className="flex items-center gap-1"><Kbd>enter</Kbd><span>accept</span></span>
          <span className="flex items-center gap-1"><Kbd>backspace</Kbd><span>reject</span></span>
          <span className="flex items-center gap-1"><Kbd>{commandLabel} + enter</Kbd><span>accept the rest</span></span>
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRejectAll}
            disabled={!canAct}
            className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={!canAct}
            className="flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-foreground hover:bg-surface-overlay disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
          >
            Accept all
            <Kbd>{commandLabel} + enter</Kbd>
          </button>
          <Button
            variant="primary"
            size="sm"
            disabled={!summary.canApply || !canAct}
            onClick={onApply}
            aria-label={summary.applyLabel}
            title={blocked ?? 'Apply the assembled replacement as one undoable edit'}
          >
            {summary.applyLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}
