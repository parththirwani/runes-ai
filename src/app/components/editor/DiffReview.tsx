"use client";

import React from 'react';
import { computeDiff, DiffToken, EditProposal } from '@/src/lib/proposal-engine';
import Button from '../design/Button';
import { Check, X, AlertTriangle } from 'lucide-react';

interface DiffReviewProps {
  proposal: EditProposal;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate?: () => void;
  stalenessReason?: string;
}

export default function DiffReview({
  proposal,
  onAccept,
  onReject,
  onRegenerate,
  stalenessReason,
}: DiffReviewProps) {
  const diffTokens: DiffToken[] = computeDiff(proposal.originalText, proposal.replacementText);
  const canAccept = proposal.state === 'pending' && !stalenessReason;

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden" role="region" aria-label="AI proposal review">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-raised border-b border-border">
        <span className="text-xs font-medium text-foreground uppercase tracking-wider">
          {proposal.source === 'paraphrase' ? 'Paraphrase Proposal' : 'AI Suggestion'}
        </span>
        {stalenessReason && (
          <span className="flex items-center gap-1 text-xs text-status-stale">
            <AlertTriangle className="w-3 h-3" />
            Stale
          </span>
        )}
      </div>

      {/* Diff content */}
      <div className="p-3 max-h-48 overflow-y-auto">
        {proposal.explanation && (
          <p className="text-xs text-muted-foreground mb-2 italic">{proposal.explanation}</p>
        )}

        {/* Original label */}
        <div className="text-[10px] text-meta uppercase mb-1 font-semibold">Original</div>
        <div className="bg-canvas border border-border rounded p-2 mb-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
          {proposal.originalText || <span className="text-meta italic">(empty)</span>}
        </div>

        {/* Diff view */}
        <div className="flex items-center gap-3 mb-1">
          <span className="text-[10px] text-meta uppercase font-semibold">Changes</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-saved">
            <span className="inline-block h-2 w-2 rounded-sm bg-success-subtle ring-1 ring-status-saved/30" aria-hidden="true" />
            Added
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-error">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive-subtle ring-1 ring-status-error/30" aria-hidden="true" />
            Removed
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-1">Added text is underlined. Removed text is struck through.</p>
        <div className="bg-canvas border border-border rounded p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {diffTokens.length === 0 ? (
            <span className="text-meta italic">No changes</span>
          ) : (
            diffTokens.map((token, i) => {
              const bg = token.type === 'add' ? 'bg-success-subtle text-status-saved underline decoration-2' :
                token.type === 'remove' ? 'bg-destructive-subtle text-status-error line-through decoration-2' : 'text-foreground';
              return (
                <span key={i} className={`${bg} rounded-sm px-0.5`} aria-label={token.type === 'equal' ? undefined : `${token.type === 'add' ? 'Added' : 'Removed'}: ${token.value}`}>
                  {token.value}
                </span>
              );
            })
          )}
        </div>

        {/* Stale notice */}
        {stalenessReason && (
          <div className="mt-2 p-2 bg-warning-subtle border border-warning/30 rounded text-xs text-warning">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            {stalenessReason}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-surface-raised border-t border-border">
        {onRegenerate && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        )}

        <Button
          variant="danger"
          size="sm"
          onClick={onReject}
          icon={<X className="w-3.5 h-3.5" />}
          aria-label="Reject proposal"
        >
          Reject
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={onAccept}
          disabled={!canAccept}
          icon={<Check className="w-3.5 h-3.5" />}
          aria-label="Accept proposal"
          title={!canAccept ? stalenessReason || 'Proposal cannot be accepted' : 'Accept proposal'}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}
