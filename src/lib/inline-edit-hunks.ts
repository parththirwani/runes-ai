// Inline edit per-change review — pure hunk model per
// docs/ai-inline-edit-plan.md §"Per-change review". No React, no Monaco, no
// side effects: build word-level hunks from the original selection and the
// server-validated replacement, record accept/reject decisions, assemble the
// final replacement, and re-check protected Markdown/LaTeX spans byte-for-byte
// before the UI commits one undoable Monaco edit.

import { computeDiff } from './proposal-engine';
import { extractProtectedLatexTokens } from './latex-utils';
import { extractProtectedMarkdownTokens } from './markdown-utils';
import type { InlineEditFormat } from './inline-edit-selection';

export type HunkDecision = 'pending' | 'accepted' | 'rejected';

export type InlineEditHunk = {
  /** Deterministic for the same (original, replacement) pair. */
  id: string;
  ordinal: number;
  originalText: string;
  newText: string;
  /** Zero-based offsets into the original selection; empty for pure insertions. */
  originalStart: number;
  originalEnd: number;
  decision: HunkDecision;
};

export type InlineEditHunkModel = {
  originalText: string;
  replacementText: string;
  hunks: InlineEditHunk[];
};

/**
 * Word-level hunks from computeDiff: every contiguous run of removed and
 * added tokens becomes one change the user can accept or reject on its own.
 */
export function buildInlineEditHunks(original: string, replacement: string): InlineEditHunkModel {
  const tokens = computeDiff(original, replacement);
  const hunks: InlineEditHunk[] = [];
  let originalOffset = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'equal') {
      originalOffset += token.value.length;
      i += 1;
      continue;
    }
    const start = originalOffset;
    let originalText = '';
    let newText = '';
    while (i < tokens.length && tokens[i].type !== 'equal') {
      const t = tokens[i];
      if (t.type === 'remove') {
        originalText += t.value;
        originalOffset += t.value.length;
      } else {
        newText += t.value;
      }
      i += 1;
    }
    const ordinal = hunks.length;
    hunks.push({
      id: `hunk-${ordinal}-${start}-${originalText.length}`,
      ordinal,
      originalText,
      newText,
      originalStart: start,
      originalEnd: start + originalText.length,
      decision: 'pending',
    });
  }
  return { originalText: original, replacementText: replacement, hunks };
}

/** Immutable decision update. Returns null when the hunk id is unknown. */
export function withHunkDecision(
  model: InlineEditHunkModel,
  hunkId: string,
  decision: HunkDecision,
): InlineEditHunkModel | null {
  if (!model.hunks.some((h) => h.id === hunkId)) return null;
  return {
    ...model,
    hunks: model.hunks.map((h) => (h.id === hunkId ? { ...h, decision } : h)),
  };
}

/** Accept-all / Reject-all. Returns the model unchanged when there are no hunks. */
export function withAllDecisions(
  model: InlineEditHunkModel,
  decision: Exclude<HunkDecision, 'pending'>,
): InlineEditHunkModel {
  return { ...model, hunks: model.hunks.map((h) => ({ ...h, decision })) };
}

export type HunkAssembly =
  | {
      ok: true;
      text: string;
      acceptedCount: number;
      rejectedCount: number;
      /** False for Reject-all: the caller must then commit zero bytes. */
      changed: boolean;
    }
  | { ok: false; reason: string };

/**
 * Interleave accepted hunks (suggested text) with rejected ones (original
 * bytes). Every hunk needs a decision first — the plan forbids an Apply that
 * silently stands in for undecided changes.
 */
export function assembleReplacement(model: InlineEditHunkModel): HunkAssembly {
  const pending = model.hunks.filter((h) => h.decision === 'pending').length;
  if (pending > 0) {
    return {
      ok: false,
      reason: `${pending} of ${model.hunks.length} changes still need a decision`,
    };
  }
  let text = '';
  let cursor = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  for (const hunk of model.hunks) {
    text += model.originalText.slice(cursor, hunk.originalStart);
    if (hunk.decision === 'accepted') {
      text += hunk.newText;
      acceptedCount += 1;
    } else {
      text += hunk.originalText;
      rejectedCount += 1;
    }
    cursor = hunk.originalEnd;
  }
  text += model.originalText.slice(cursor);
  return { ok: true, text, acceptedCount, rejectedCount, changed: text !== model.originalText };
}

export type ProtectionCheck = { ok: true } | { ok: false; reason: string };

function shortenForMessage(token: string): string {
  return token.length > 40 ? `${token.slice(0, 40)}…` : token;
}

/**
 * Mixed accept/reject can cut a protected span in half even when each side
 * was individually valid, so re-check every protected span of the original
 * against the assembled text: same bytes, same order, no overlap.
 */
export function verifyProtectedSpansPreserved(
  original: string,
  assembled: string,
  format: InlineEditFormat,
): ProtectionCheck {
  const tokens = format === 'markdown'
    ? extractProtectedMarkdownTokens(original)
    : extractProtectedLatexTokens(original);
  let searchFrom = 0;
  for (const token of tokens) {
    const idx = assembled.indexOf(token, searchFrom);
    if (idx === -1) {
      return {
        ok: false,
        reason: `Protected ${format === 'markdown' ? 'Markdown' : 'LaTeX'} text "${shortenForMessage(token)}" would be changed or reordered — adjust the decisions before applying`,
      };
    }
    searchFrom = idx + token.length;
  }
  return { ok: true };
}

/**
 * What the Apply control calls: assemble, then re-run syntax protection.
 * On ok && changed the UI still has to recheck the anchor (anchorStaleReason)
 * and commit one undoable Monaco edit; on ok && !changed it commits nothing.
 */
export function finalizeInlineEditReplacement(
  model: InlineEditHunkModel,
  format: InlineEditFormat,
): HunkAssembly {
  const assembled = assembleReplacement(model);
  if (!assembled.ok) return assembled;
  const protection = verifyProtectedSpansPreserved(model.originalText, assembled.text, format);
  if (!protection.ok) return protection;
  return assembled;
}
