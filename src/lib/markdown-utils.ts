// Markdown context scanner, selection protection, and completion filter.
// Pure functions — no React, no side effects.
//
// Supported profile (documented in README): CommonMark/GFM subset —
// headings, paragraphs, emphasis, links, lists, task lists, blockquotes,
// fenced code, tables, thematic breaks, images, inline ($...$) and display
// ($$...$$) math. Raw HTML is unsupported source text and is never rendered.

import { PLACEHOLDER_PREFIX, escapeRegex } from './latex-utils';

export type MarkdownContext = {
  isInFrontMatter: boolean;
  isInFencedCode: boolean;
  isInInlineCode: boolean;
  isInMath: boolean;
  isInLinkDestination: boolean;
  isInImageUrl: boolean;
  isInRawHtml: boolean;
  isInTableDelimiter: boolean;
  isInHeadingMarker: boolean;
  isInListMarker: boolean;
  isInReferenceDefinition: boolean;
  inReferenceTarget: boolean;
};

export type MarkdownScanResult = MarkdownContext & {
  /** True when a suggestion or paraphrase selection must not be offered. */
  inProtected: boolean;
};

function frontMatterEnd(source: string): number {
  const open = source.match(/^---\r?\n/);
  if (!open) return -1;
  const rest = source.slice(open[0].length);
  const close = rest.match(/\r?\n---(\r?\n|$)/);
  if (!close) return source.length; // unterminated front matter protects the rest
  return open[0].length + (close.index ?? 0) + close[0].length;
}

/** Replace fenced code and inline code spans with spaces (same length). */
function blankCode(source: string): string {
  return source
    .replace(/(```|~~~)[\s\S]*?\1/g, (m) => ' '.repeat(m.length))
    .replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (m) => ' '.repeat(m.length));
}

export function scanMarkdownContext(fullSource: string, offset: number): MarkdownScanResult {
  const boundedOffset = Math.max(0, Math.min(offset, fullSource.length));
  const before = fullSource.slice(0, boundedOffset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineUpToCursor = before.slice(lineStart);
  const lineNumber = before.split('\n').length;

  const fmEnd = frontMatterEnd(fullSource);
  const isInFrontMatter = fmEnd >= 0 && boundedOffset < fmEnd;

  // Fence state: walk lines up to (and including the start of) the cursor line.
  let inFence = false;
  let fenceMarker: string | null = null;
  const lines = fullSource.split('\n');
  for (let i = 0; i < Math.min(lineNumber - 1, lines.length); i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceMarker) { fenceMarker = fence[1][0]; inFence = true; }
      else if (fence[1][0] === fenceMarker) { fenceMarker = null; inFence = false; }
    }
  }
  // Cursor line itself may open a fence before the offset.
  let isInFencedCode = inFence;
  const fenceOpenOnLine = lineUpToCursor.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (fenceOpenOnLine && !inFence) isInFencedCode = true;

  // Inline code: odd count of unescaped backtick runs on the cursor line.
  let isInInlineCode = false;
  if (!isInFencedCode) {
    const backtickRuns = lineUpToCursor.match(/(?<!\\)`+/g) || [];
    let open: string | null = null;
    for (const run of backtickRuns) {
      if (open === null) open = run;
      else if (run === open) open = null;
    }
    isInInlineCode = open !== null;
  }

  // Math delimiters outside code.
  const cleanedBefore = blankCode(before);
  let isInMath = false;
  {
    const displayCount = (cleanedBefore.match(/(?<!\\)\$\$/g) || []).length;
    const singles = cleanedBefore.replace(/\$\$/g, '');
    const inlineCount = (singles.match(/(?<!\\)\$/g) || []).length;
    isInMath = displayCount % 2 === 1 || inlineCount % 2 === 1;
  }

  // Link/image destinations: `](` or `][` immediately behind the cursor flow.
  const destinationMatch = lineUpToCursor.match(/(!?)\[([^\]]*)\]\(([^)]*)$/);
  const isInLinkDestination = destinationMatch !== null && destinationMatch[1] !== '!';
  const isInImageUrl = destinationMatch !== null && destinationMatch[1] === '!';
  const referenceUsage = lineUpToCursor.match(/(!?)\[([^\]]*)\]\[[^\]]*$/);
  const inReferenceTarget = referenceUsage !== null;

  // Raw HTML: an unclosed `<tag` sequence that is not an autolink.
  const htmlOpen = lineUpToCursor.match(/<(!?\/?[a-zA-Z][^>]*)$/);
  const autolinkOpen = lineUpToCursor.match(/<[a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*$/);
  const isInRawHtml = htmlOpen !== null && autolinkOpen === null;

  // Structural line shapes.
  const isInTableDelimiter = /^\s*\|?[\s:|-]+\|?\s*$/.test(lineUpToCursor) && lineUpToCursor.includes('-') && lineUpToCursor.includes('|');
  const isInHeadingMarker = /^#{1,6}(\s+)?$/.test(lineUpToCursor);
  const isInListMarker = /^\s*([-*+]\s+(\[[ xX]\]\s*)?|\d+[.)]\s+|>\s*)$/.test(lineUpToCursor);
  const isInReferenceDefinition = /^\s{0,3}\[[^\]]*\]:(\s+\S*)?$/.test(lineUpToCursor);

  const inProtected =
    isInFrontMatter || isInFencedCode || isInInlineCode || isInMath ||
    isInLinkDestination || isInImageUrl || inReferenceTarget || isInRawHtml ||
    isInTableDelimiter || isInHeadingMarker || isInListMarker || isInReferenceDefinition;

  return {
    isInFrontMatter, isInFencedCode, isInInlineCode, isInMath,
    isInLinkDestination, isInImageUrl, inReferenceTarget,
    isInRawHtml, isInTableDelimiter, isInHeadingMarker, isInListMarker,
    isInReferenceDefinition, inProtected,
  };
}

// Line starts that mark structure. Selections containing them are rejected so
// a provider response can never change a list prefix, heading marker, quote,
// or table row.
const STRUCTURAL_LINE = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\||\[[^\]]+\]:)/;

const MD_PROTECTED_PATTERNS: RegExp[] = [
  /(```|~~~)[\s\S]*?\1/g,                      // fenced code
  /<!--[\s\S]*?-->/g,                          // HTML comments
  /\$\$[\s\S]*?\$\$/g,                         // display math
  /(?<!\\)\$(?!\s)(?:[^$\\]|\\.)+?(?<!\\)\$/g, // inline math
  /!\[[^\]]*\]\([^)]*\)/g,                     // inline images (full syntax)
  /!\[[^\]]*\]\[[^\]]*\]/g,                    // reference images
  /\[[^\]]*\]\([^)]*\)/g,                      // inline links (full syntax)
  /\[[^\]]*\]\[[^\]]*\]/g,                     // reference links
  /^\s{0,3}\[[^\]]+\]:.*$/gm,                  // reference definitions
  /(`+)(?:(?!\1)[\s\S])*?\1/g,                 // inline code
  /(?<!\w)(\*\*|__)(?=\S)[\s\S]*?\1(?!\w)/g,   // strong emphasis
  /(?<!\w)(\*|_)(?=\S)[^*_\n]*?\1(?!\w)/g,     // emphasis
  /~~(?=\S)[^~\n]*?~~/g,                       // strikethrough
  /<[a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*>/g,        // autolinks
];

export type MarkdownSelectionAnalysis = {
  eligible: boolean;
  reason?: string;
  protectedTokens: { placeholder: string; original: string }[];
  maskedSelection: string;
};

export function analyzeMarkdownSelection(selectedText: string, context: MarkdownScanResult): MarkdownSelectionAnalysis {
  const fail = (reason: string): MarkdownSelectionAnalysis =>
    ({ eligible: false, reason, protectedTokens: [], maskedSelection: '' });

  if (!selectedText || selectedText.length === 0) return fail('Empty selection');
  if (context.isInFrontMatter) return fail('Selection is inside YAML front matter');
  if (context.isInFencedCode) return fail('Selection is inside a fenced code block');
  if (context.isInInlineCode) return fail('Selection is inside inline code');
  if (context.isInMath) return fail('Selection is inside math');
  if (context.isInLinkDestination || context.isInImageUrl || context.inReferenceTarget) {
    return fail('Selection is inside a link or image destination');
  }
  if (context.isInRawHtml) return fail('Selection is inside raw HTML, which is unsupported');
  if (/<!--/.test(selectedText)) return fail('Selection contains an HTML comment, which is unsupported');
  if (/<[!/a-zA-Z][^>]*>/.test(selectedText)) return fail('Selection contains raw HTML, which is unsupported');
  if (selectedText.includes(PLACEHOLDER_PREFIX)) return fail('Selection contains a reserved placeholder');
  if (selectedText.split('\n').some((line) => /^\s{0,3}\[[^\]]+\]:/.test(line))) {
    return fail('Selection contains a link reference definition');
  }
  if (selectedText.split('\n').some((line) => line.includes('|'))) {
    return fail('Selection contains table syntax — select prose inside a cell, not the row');
  }
  const contentLines = selectedText.split('\n').filter((line) => line.trim() !== '');
  if (contentLines.some((line) => STRUCTURAL_LINE.test(line))) {
    return fail('Selection contains a heading, list, quote, or code marker — select prose within a single item');
  }

  const protectedTokens: { placeholder: string; original: string }[] = [];
  let masked = selectedText;
  for (const pattern of MD_PROTECTED_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const placeholder = `${PLACEHOLDER_PREFIX}${protectedTokens.length}__`;
      protectedTokens.push({ placeholder, original: match });
      return placeholder;
    });
  }

  const prose = masked.replace(new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}\\d+__`, 'g'), '');
  // Complete Markdown constructs were replaced with placeholders above. A
  // remaining delimiter belongs to a partial construct crossing a selection
  // boundary, so rewriting it could leave the document's formatting broken.
  if (/[`*_~$\[\]]/.test(prose)) {
    return fail('Select complete Markdown formatting or only the prose inside it');
  }
  if (!/[\p{L}\p{N}]/u.test(prose)) {
    return fail('Select prose as well as Markdown tokens');
  }

  return { eligible: true, protectedTokens, maskedSelection: masked };
}

export type MarkdownRestoreResult =
  | { success: true; restored: string }
  | { success: false; reason: string };

export function verifyMarkdownRestore(
  modelResponse: string,
  protectedTokens: { placeholder: string; original: string }[],
): MarkdownRestoreResult {
  if (!modelResponse || /```|~~~/.test(modelResponse)) {
    return { success: false, reason: 'Invalid AI response' };
  }

  for (let i = 0; i < protectedTokens.length; i++) {
    const re = new RegExp(escapeRegex(protectedTokens[i].placeholder), 'g');
    const count = (modelResponse.match(re) || []).length;
    if (count !== 1) {
      return { success: false, reason: `Protected token ${i} appears ${count} times (expected exactly 1) — refusing to restore` };
    }
  }

  const flatPlaceholders = modelResponse.match(new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}\\d+__`, 'g')) || [];
  if (flatPlaceholders.length !== protectedTokens.length) {
    return { success: false, reason: 'Unexpected protected placeholder in AI response' };
  }
  const seenIndexes = new Set<number>();
  for (const placeholder of flatPlaceholders) {
    const idx = parseInt(placeholder.slice(PLACEHOLDER_PREFIX.length, -2), 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= protectedTokens.length || seenIndexes.has(idx)) {
      return { success: false, reason: 'Unexpected protected placeholder in AI response' };
    }
    seenIndexes.add(idx);
  }

  // With every protected token removed, the remaining prose must not contain
  // Markdown syntax characters that could alter structure, raw HTML, or new
  // URLs/link targets.
  const proseOnly = protectedTokens.reduce((text, token) => text.replace(token.placeholder, ''), modelResponse);
  if (/[<>`$#|*_~[\]\\]/.test(proseOnly)) {
    return { success: false, reason: 'AI response introduced Markdown syntax or raw HTML' };
  }
  if (/(https?:|www\.|\/\/|\bmailto:)/i.test(proseOnly)) {
    return { success: false, reason: 'AI response introduced a URL' };
  }

  let restored = modelResponse;
  for (const token of protectedTokens) {
    restored = restored.replace(token.placeholder, token.original);
  }
  return { success: true, restored };
}

export function filterMarkdownCompletion(insertion: string, prefix: string): { accepted: boolean; reason?: string } {
  if (!insertion || insertion.trim().length === 0) return { accepted: false, reason: 'Empty insertion' };
  if (insertion.length > 200) return { accepted: false, reason: `Insertion exceeds 200 chars (${insertion.length})` };
  const currentLine = prefix.slice(prefix.lastIndexOf('\n') + 1).trimStart();
  if (currentLine && insertion.trimStart().startsWith(currentLine)) {
    return { accepted: false, reason: 'Insertion repeats existing prefix' };
  }
  if (/```|~~~|\r|\n/.test(insertion)) return { accepted: false, reason: 'Insertion is not a short prose continuation' };
  if (/[<>`$#|*_~[\]()\\]/.test(insertion)) return { accepted: false, reason: 'Insertion contains Markdown syntax' };
  if (/(https?:|www\.|\/\/)/i.test(insertion)) return { accepted: false, reason: 'Insertion contains a URL' };
  if (/^\s*([-*+]|\d+[.)]|\d+\)|>)/.test(insertion)) return { accepted: false, reason: 'Insertion starts a list or quote' };
  if (insertion.trim().length < 3) return { accepted: false, reason: 'Insertion is too short' };
  return { accepted: true };
}

/** True when the caret sits on a structural line where completion is off. */
export function markdownLineIsProse(lineUpToCursor: string): boolean {
  if (/^\s{0,3}(#{1,6}(\s|$)|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\||\[[^\]]+\]:)/.test(lineUpToCursor)) return false;
  if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lineUpToCursor) && lineUpToCursor.includes('|') && lineUpToCursor.includes('-')) return false;
  return true;
}
