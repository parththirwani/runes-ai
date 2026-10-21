// Proposal engine — shared pure types and logic for edit proposals
// No React, no side effects.

import { diffWordsWithSpace } from 'diff';

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export type ProposalSource = 'paraphrase' | 'autocomplete';

export type ProposalState = 'pending' | 'stale' | 'accepted' | 'rejected';

export type EditProposal = {
  id: string;
  documentId: string;
  source: ProposalSource;
  /** Monaco model version at proposal creation */
  baseModelVersion: number;
  /** Zero-based character offsets in the current model */
  range: { startOffset: number; endOffset: number };
  originalText: string;
  replacementText: string;
  explanation?: string;
  state: ProposalState;
};

// -------------------------------------------------------------------------
// Diff helpers
// -------------------------------------------------------------------------

export type DiffToken = {
  value: string;
  type: 'add' | 'remove' | 'equal';
};

export function computeDiff(original: string, replacement: string): DiffToken[] {
  if (original.length + replacement.length > 10_000) {
    return [
      ...(original ? [{ value: original, type: 'remove' as const }] : []),
      ...(replacement ? [{ value: replacement, type: 'add' as const }] : []),
    ];
  }
  try {
    const changes = diffWordsWithSpace(original, replacement);
    return changes.map((part) => ({
      value: part.value,
      type: part.added ? 'add' as const : part.removed ? 'remove' as const : 'equal' as const,
    }));
  } catch {
    return [
      ...(original ? [{ value: original, type: 'remove' as const }] : []),
      ...(replacement ? [{ value: replacement, type: 'add' as const }] : []),
    ];
  }
}

// -------------------------------------------------------------------------
// Stale detection
// -------------------------------------------------------------------------

export type StaleCheck = {
  isStale: boolean;
  reason?: string;
};

export function checkStale(
  proposal: EditProposal,
  currentDocumentId: string,
  currentModelVersion: number,
  currentTextAtRange: string | null,
): StaleCheck {
  if (proposal.documentId !== currentDocumentId) {
    return { isStale: true, reason: 'Document changed' };
  }
  if (proposal.baseModelVersion !== currentModelVersion) {
    // Model version changed — this means something was edited
    // We check if the actual text still matches
    if (currentTextAtRange !== null && currentTextAtRange !== proposal.originalText) {
      return { isStale: true, reason: 'Selection text has been modified' };
    }
    // Text still matches? Could be an edit elsewhere. Mark stale to be safe.
    return { isStale: true, reason: 'Document was edited elsewhere — proposal invalidated' };
  }
  if (proposal.state === 'stale') {
    return { isStale: true, reason: 'Proposal was previously marked stale' };
  }
  return { isStale: false };
}

// -------------------------------------------------------------------------
// Application
// -------------------------------------------------------------------------

export type ApplyResult = {
  applied: boolean;
  reason?: string;
};

/**
 * Verify that a proposal can still be accepted against the given model state.
 * Returns a result indicating whether the edit is safe to apply.
 */
export function verifyAcceptance(
  proposal: EditProposal,
  currentFullText: string,
): ApplyResult {
  if (proposal.state === 'stale') {
    return { applied: false, reason: 'Proposal is stale' };
  }
  if (proposal.state === 'accepted' || proposal.state === 'rejected') {
    return { applied: false, reason: `Proposal was already ${proposal.state}` };
  }

  // Reject malformed ranges before slicing. Without this check, a negative or
  // inverted range can accidentally pass when originalText is empty (or when
  // String#slice normalizes the offsets in an unexpected way).
  const { startOffset, endOffset } = proposal.range;
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
      startOffset < 0 || endOffset < startOffset || endOffset > currentFullText.length) {
    return { applied: false, reason: 'Proposal range is invalid for the current document' };
  }

  // Verify the original text is still at the specified range
  const actualText = currentFullText.slice(startOffset, endOffset);
  if (actualText !== proposal.originalText) {
    return { applied: false, reason: 'The selected text no longer matches the original — the document was edited' };
  }

  return { applied: true };
}

// -------------------------------------------------------------------------
// Unique ID
// -------------------------------------------------------------------------

let _counter = 0;
export function generateProposalId(): string {
  _counter++;
  return `prop_${Date.now()}_${_counter}_${Math.random().toString(36).slice(2, 8)}`;
}
