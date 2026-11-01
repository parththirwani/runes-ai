'use client';

// AI inline edit — anchored prompt, streaming, error and receipt surfaces.
// Presentational only: every value comes from the controller in DocumentEditor,
// which owns the state machine (src/lib/inline-edit-state.ts), the anchor
// (src/lib/inline-edit-selection.ts) and the stream reader
// (src/lib/inline-edit-stream.ts). Visual states follow the public Arc inline
// edit reference captured in docs/screenshots/ai-inline-edit-reference/.

import React from 'react';
import { AlertTriangle, ArrowUp, Check, ChevronDown, Square, Undo2, Wand2, X } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Button from '../design/Button';
import type { DiffToken } from '@/src/lib/proposal-engine';
import type { HunkDecision } from '@/src/lib/inline-edit-hunks';
import { groupDiffSegments } from '@/src/lib/inline-edit-review';
import {
  INLINE_EDIT_QUICK_ACTION_IDS,
  INLINE_EDIT_QUICK_ACTION_LABELS,
  type InlineEditQuickActionId,
} from '@/src/lib/inline-edit-selection';

const CARD_CLASS = 'rounded-lg border border-border bg-surface shadow-overlay text-foreground';

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-surface-raised px-1 font-mono text-[10px] leading-none text-meta">
      {children}
    </kbd>
  );
}

/** Reference footer hint: what the shortcut does while nothing is open. */
export function InlineEditIdleHint({ shortcutLabel = 'Ctrl K' }: { shortcutLabel?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-meta">
      <Wand2 className="h-3 w-3 text-action" aria-hidden="true" />
      <span>Select text and press</span>
      <Kbd>{shortcutLabel}</Kbd>
      <span>to edit with AI</span>
    </p>
  );
}

/** Selection bubble. Never rendered for read-only users (see shouldShowEditBubble). */
export function InlineEditBubble({
  onOpen,
  shortcutLabel = 'Ctrl K',
}: {
  onOpen: () => void;
  shortcutLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={'Edit selection with AI (shortcut ' + shortcutLabel + ')'}
      className={`${CARD_CLASS} inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-surface-raised [@media(pointer:coarse)]:min-h-11`}
    >
      <Wand2 className="h-3 w-3 text-action" aria-hidden="true" />
      <span>Edit</span>
      <Kbd>{shortcutLabel}</Kbd>
    </button>
  );
}

/**
 * Word-level diff text: removed words are struck through, added words
 * underlined, with a text legend and per-change labels so colour is never the
 * only signal. Changed runs are focusable buttons while a review is open.
 */
export function InlineEditDiffText({
  tokens,
  decisions,
  focusOrdinal = null,
  onFocusChange,
  onToggleChange,
  totalChanges,
}: {
  tokens: DiffToken[];
  decisions?: HunkDecision[];
  focusOrdinal?: number | null;
  onFocusChange?: (ordinal: number) => void;
  onToggleChange?: (ordinal: number) => void;
  totalChanges?: number;
}) {
  const segments = groupDiffSegments(tokens);
  const interactive = onFocusChange !== undefined;
  const shown = totalChanges ?? segments.filter((segment) => segment.kind === 'change').length;

  if (segments.length === 0) {
    return <p className="font-mono text-xs text-meta italic">No changes</p>;
  }

  return (
    <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
      {segments.map((segment, index) => {
        if (segment.kind === 'equal') {
          return <span key={'equal-' + index} className="text-foreground">{segment.text}</span>;
        }
        const status = decisions?.[segment.ordinal];
        const focused = focusOrdinal === segment.ordinal;
        const label = 'Change ' + (segment.ordinal + 1) + ' of ' + Math.max(shown, segment.ordinal + 1) +
          ': ' + (segment.removed ? 'removed ' + JSON.stringify(segment.removed) : 'nothing removed') +
          ', ' + (segment.added ? 'added ' + JSON.stringify(segment.added) : 'nothing added') +
          (status && status !== 'pending' ? ', ' + status : '') +
          (onToggleChange ? '. Activate to ' + (status === 'rejected' ? 'use suggestion' : 'keep original') : '');
        const marks = (
          <>
            {segment.removed !== '' && (
              <del className="bg-destructive-subtle text-status-error no-underline line-through decoration-2">{segment.removed}</del>
            )}
            {segment.added !== '' && (
              <ins className="bg-success-subtle text-status-saved no-underline underline decoration-2">{segment.added}</ins>
            )}
          </>
        );
        if (!interactive) {
          return <span key={'change-' + segment.ordinal} aria-label={label}>{marks}</span>;
        }
        return (
          <button
            key={'change-' + segment.ordinal}
            type="button"
            aria-label={label}
            aria-current={focused ? 'true' : undefined}
            data-hunk-ordinal={segment.ordinal}
            onFocus={() => onFocusChange(segment.ordinal)}
            onClick={() => {
              onFocusChange(segment.ordinal);
              onToggleChange?.(segment.ordinal);
            }}
            className={
              'rounded-sm px-0.5 align-baseline ' +
              (focused ? 'ring-1 ring-action bg-surface-raised' : 'hover:bg-surface-raised')
            }
          >
            {marks}
            {status === 'rejected' && (
              <span className="ml-0.5 align-super font-sans text-[9px] uppercase tracking-wide text-meta">
                original
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function InlineEditDiffLegend() {
  return (
    <p className="text-[10px] text-meta">
      Removed text is struck through. Added text is underlined.
    </p>
  );
}

export interface InlineEditPromptProps {
  selectionPreview: string;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onSubmitInstruction: () => void;
  onQuickAction: (action: InlineEditQuickActionId) => void;
  onDismiss: () => void;
  validationError: string | null;
  instructionLimit: number;
  busy?: boolean;
}

/** Prompt card: the instruction is primary; presets remain one click away. */
export function InlineEditPromptCard({
  selectionPreview,
  instruction,
  onInstructionChange,
  onSubmitInstruction,
  onQuickAction,
  onDismiss,
  validationError,
  instructionLimit,
  busy = false,
}: InlineEditPromptProps) {
  return (
    <div className={`${CARD_CLASS} w-[min(23rem,calc(100vw-2rem))] overflow-hidden p-3`} role="dialog" aria-label="Edit with AI">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-foreground">Edit with AI</h2>
          <p className="mt-1 truncate text-[11px] text-meta" title={selectionPreview}>“{selectionPreview}”</p>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Close AI edit" title="Close (Esc)" className="-mr-1 -mt-1 shrink-0 rounded p-1 text-meta hover:bg-surface-raised hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1 rounded-md border border-border bg-canvas p-1 focus-within:border-action">
        <input
          type="text"
          value={instruction}
          maxLength={instructionLimit}
          disabled={busy}
          autoFocus
          onChange={(event) => onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmitInstruction();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onDismiss();
            }
          }}
          placeholder="Describe the change…"
          aria-label="Instruction for AI"
          aria-invalid={validationError !== null}
          aria-describedby={validationError ? 'inline-edit-instruction-error' : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-meta"
        />
        <button type="button" onClick={onSubmitInstruction} disabled={busy || validationError !== null || instruction.trim() === ''} aria-label="Rewrite selection" title="Rewrite selection (Enter)" className="flex size-7 shrink-0 items-center justify-center rounded bg-action text-white disabled:bg-surface-raised disabled:text-meta">
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1" role="group" aria-label="Quick edits">
        {(['clearer', 'shorter'] as const).map((action) => (
          <button key={action} type="button" disabled={busy} onClick={() => onQuickAction(action)} aria-label={'Quick edit: ' + INLINE_EDIT_QUICK_ACTION_LABELS[action]} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-raised hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:min-h-11">
            {INLINE_EDIT_QUICK_ACTION_LABELS[action]}
          </button>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" disabled={busy} aria-label="More quick edits" className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-raised hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:min-h-11">More <ChevronDown className="size-3" aria-hidden="true" /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={4} className="z-[70] min-w-36 rounded-md border border-border bg-surface-overlay p-1 shadow-overlay">
              {INLINE_EDIT_QUICK_ACTION_IDS.filter((action) => action !== 'clearer' && action !== 'shorter').map((action) => (
                <DropdownMenu.Item key={action} onSelect={() => onQuickAction(action)} aria-label={'Quick edit: ' + INLINE_EDIT_QUICK_ACTION_LABELS[action]} className="cursor-pointer rounded px-2.5 py-2 text-xs text-foreground outline-none data-[highlighted]:bg-surface-raised">{INLINE_EDIT_QUICK_ACTION_LABELS[action]}</DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {instruction.length >= instructionLimit - 50 && <span className="ml-auto text-[10px] tabular-nums text-meta">{instruction.length}/{instructionLimit}</span>}
      </div>
      {validationError && (
        <p id="inline-edit-instruction-error" role="alert" className="mt-2 flex items-start gap-1 text-[11px] text-status-error">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{validationError}</span>
        </p>
      )}
    </div>
  );
}

export interface InlineEditStreamingProps {
  tokens: DiffToken[];
  originalText: string;
  onStop: () => void;
  /** True when a partial result cannot be reviewed, per plan step 3. */
  partialReviewable?: boolean;
}

/** Streaming bar plus a word-revealed preview. The model keeps its own bytes. */
export function InlineEditStreamingCard({
  tokens,
  originalText,
  onStop,
  partialReviewable = true,
}: InlineEditStreamingProps) {
  return (
    <div className={`${CARD_CLASS} w-[min(24rem,calc(100vw-2rem))] overflow-hidden`} role="region" aria-label="AI is writing the replacement">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="h-2 w-2 rounded-sm skeleton" aria-hidden="true" />
          Editing
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-foreground hover:bg-surface-overlay [@media(pointer:coarse)]:min-h-11"
          >
            <Square className="h-2.5 w-2.5" aria-hidden="true" />
            Stop
          </button>
          <Kbd>esc</Kbd>
        </span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          Writing the replacement word by word. The source is unchanged until you accept.
        </p>
        <InlineEditDiffLegend />
        <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-canvas p-2">
          <InlineEditDiffText tokens={tokens} />
        </div>
        {!partialReviewable && originalText.length > 0 && (
          <p className="text-[10px] text-meta">Stop discards a partial result that cannot be validated.</p>
        )}
      </div>
    </div>
  );
}

/** Failure state: honest message, optional retry, zero bytes touched. */
export function InlineEditErrorCard({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`${CARD_CLASS} w-[min(22rem,calc(100vw-2rem))] border-destructive/40 p-2.5`} role="alert">
      <p className="flex items-start gap-1.5 text-[11px] text-destructive">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss} icon={<X className="h-3.5 w-3.5" />}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** Receipt after the single undoable edit, mirroring the reference "Applied 2 of 2 / Undo". */
export function InlineEditAppliedReceipt({
  acceptedCount,
  total,
  keptOriginal,
  onUndo,
  onDismiss,
}: {
  acceptedCount: number;
  total: number;
  keptOriginal: boolean;
  onUndo?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5`} role="status" aria-live="polite">
      <span className="flex items-center gap-1.5 text-[11px] text-foreground">
        {keptOriginal
          ? <X className="h-3 w-3 text-status-stale" aria-hidden="true" />
          : <Check className="h-3 w-3 text-status-saved" aria-hidden="true" />}
        <span>{keptOriginal ? 'Kept the original' : 'Applied ' + acceptedCount + ' of ' + total}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {!keptOriginal && onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] hover:bg-surface-overlay [@media(pointer:coarse)]:min-h-11"
          >
            <Undo2 className="h-3 w-3" aria-hidden="true" />
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss applied receipt"
          className="text-[11px] text-meta hover:text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          Close
        </button>
      </span>
    </div>
  );
}
