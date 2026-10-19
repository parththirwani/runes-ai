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
    <div className="bg-[#252526] border border-[#3e3e3e] rounded-lg overflow-hidden" role="region" aria-label="AI proposal review">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#3e3e3e]">
        <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
          {proposal.source === 'paraphrase' ? 'Paraphrase Proposal' : 'AI Suggestion'}
        </span>
        {stalenessReason && (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <AlertTriangle className="w-3 h-3" />
            Stale
          </span>
        )}
      </div>

      {/* Diff content */}
      <div className="p-3 max-h-48 overflow-y-auto">
        {proposal.explanation && (
          <p className="text-xs text-gray-400 mb-2 italic">{proposal.explanation}</p>
        )}

        {/* Original label */}
        <div className="text-[10px] text-gray-500 uppercase mb-1 font-semibold">Original</div>
        <div className="bg-[#1e1e1e] border border-[#3e3e3e] rounded p-2 mb-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {proposal.originalText || <span className="text-gray-600 italic">(empty)</span>}
        </div>

        {/* Diff view */}
        <div className="text-[10px] text-gray-500 uppercase mb-1 font-semibold">Changes</div>
        <div className="bg-[#1e1e1e] border border-[#3e3e3e] rounded p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {diffTokens.length === 0 ? (
            <span className="text-gray-500 italic">No changes</span>
          ) : (
            diffTokens.map((token, i) => {
              const bg = token.type === 'add' ? 'bg-green-900/40 text-green-300' :
                token.type === 'remove' ? 'bg-red-900/40 text-red-300 line-through' : 'text-gray-300';
              return (
                <span key={i} className={`${bg} rounded-sm px-0.5`}>
                  {token.value}
                </span>
              );
            })
          )}
        </div>

        {/* Stale notice */}
        {stalenessReason && (
          <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded text-xs text-yellow-300">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            {stalenessReason}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-[#2d2d2d] border-t border-[#3e3e3e]">
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