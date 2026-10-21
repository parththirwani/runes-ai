// LaTeX context scanner and protected-token utilities
// Pure functions — no React, no side effects.

const MATH_ENV_NAMES = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multiline', 'multiline*', 'split', 'array', 'cases', 'matrix',
  'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
]);

const VERBATIM_ENV_NAMES = new Set([
  'verbatim', 'verbatim*', 'lstlisting', 'minted', 'alltt',
]);

// Protected token patterns we recognise and mask
const PROTECTED_PATTERNS: RegExp[] = [
  /\\cite(?:\[[^\]]*\])?\{[^}]+\}/g,
  /\\ref\{[^}]+\}/g,
  /\\label\{[^}]+\}/g,
  /\\pageref\{[^}]+\}/g,
  /\$\$[^$]*\$\$/g,
  /\$(?:[^$\\]|\\.)*\$/g,
  /\\\[[\s\S]*?\\\]/g,
  /\\begin\{([^}]+)\}[\s\S]*?\\end\{\1\}/g,
  /\\(?:[a-zA-Z]+)(?:\{[^}]*\})?/g,
  /\\[%_&#$~^{}\\]/g,
];

// -- Helpers ----------------------------------------------------------------

/**
 * Scan backward from `before` (the text before offset) to determine whether
 * the cursor is inside inline $...$ or display $$...$$ math delimiters.
 *
 * Tokenizes $$ as a single display-math delimiter and $ as an inline
 * delimiter.  Odd total depth means we are inside an unclosed pair.
 * Escaped \$ is stripped first so it does not count.
 */
function scanMathDelimiters(before: string): boolean {
  // Strip escaped \$ so they don't confuse counting.
  // The regex /\$/g matches a literal backslash followed by a dollar sign.
  // In JS source: /\\$/g  (one esc backslash + $)
  const cleaned = before.replace(/\\\$/g, '');
  let depth = 0;
  for (let i = 0; i < cleaned.length; ) {
    if (cleaned[i] === '$') {
      if (i + 1 < cleaned.length && cleaned[i + 1] === '$') {
        depth++;
        i += 2;
      } else {
        depth++;
        i += 1;
      }
    } else {
      i++;
    }
  }
  return depth % 2 === 1;
}

// -- Context scanner -------------------------------------------------------

export type ScanContext = {
  isInDocument: boolean;
  isInPreamble: boolean;
  isInComment: boolean;
  isInMath: boolean;
  isInVerbatim: boolean;
  isInCommandName: boolean;
  isInCommandArg: boolean;
};

const documentBegin = /\\begin\{document\}/;
const documentEnd   = /\\end\{document\}/;

export function scanContext(fullSource: string, offset: number): ScanContext {
  const before = fullSource.slice(0, offset);
  const uncommentedBefore = stripComments(before);

  // Comment detection
  const lastNewline = before.lastIndexOf('\n');
  const lineUpToCursor = before.slice(lastNewline + 1);
  // Check if there's an unescaped % on this line up to the cursor.
  // Escaped \% is not a comment start.
  const commentIdx = findCommentStart(lineUpToCursor);
  const atPercent = offset < fullSource.length && fullSource[offset] === '%';
  // A percent is escaped only by an odd number of preceding backslashes.
  const inComment = commentIdx >= 0 ||
    (atPercent && findCommentStart(fullSource.slice(lastNewline + 1, offset + 1)) >= 0);

  // Preamble detection
  const docStart = fullSource.match(documentBegin);
  const docEndMatch = fullSource.match(documentEnd);
  const inDocument = docStart !== null && offset >= (docStart.index ?? 0) + docStart[0].length;
  const pastDocEnd = docEndMatch !== null && offset >= (docEndMatch.index ?? 0) + docEndMatch[0].length;

  if (pastDocEnd) {
    return { isInDocument: false, isInPreamble: false, isInComment: inComment, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
  }

  const inPreamble = !inDocument;

  // Environment stack
  const envStack = scanEnvStack(uncommentedBefore, uncommentedBefore.length);
  const inMathEnv = envStack.some(e => MATH_ENV_NAMES.has(e));
  const inVerbatim = envStack.some(e => VERBATIM_ENV_NAMES.has(e));

  // Inline/display math via $...$ / $$...$$ delimiters (not caught by env stack)
  const inMathDelim = scanMathDelimiters(stripVerbatimContent(uncommentedBefore));
  const isInMath = inMathEnv || inMathDelim;

  // Command name check
  const precedingText = before.slice(Math.max(0, before.length - 100));
  const cmdMatch = precedingText.match(/(\\(?:[a-zA-Z]+))$/);
  const inCommandName = cmdMatch !== null && offset >= (before.length - cmdMatch[0].length) && offset <= before.length;
  const inCommandArg = checkCommandArg(before);

  return { isInDocument: inDocument && !pastDocEnd, isInPreamble: inPreamble, isInComment: inComment, isInMath, isInVerbatim: inVerbatim, isInCommandName: inCommandName, isInCommandArg: inCommandArg };
}

function findCommentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '%') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) return i;
  }
  return -1;
}

function stripComments(source: string): string {
  return source.split('\n').map(line => {
    const index = findCommentStart(line);
    return index < 0 ? line : line.slice(0, index) + ' '.repeat(line.length - index);
  }).join('\n');
}

function stripVerbatimContent(source: string): string {
  for (const name of VERBATIM_ENV_NAMES) {
    const begin = `\\begin{${name}}`;
    const end = `\\end{${name}}`;
    let start = source.indexOf(begin);
    while (start >= 0) {
      const close = source.indexOf(end, start + begin.length);
      const stop = close < 0 ? source.length : close + end.length;
      source = source.slice(0, start) + ' '.repeat(stop - start) + source.slice(stop);
      start = source.indexOf(begin, stop);
    }
  }
  return source;
}

function scanEnvStack(source: string, offset: number): string[] {
  const stack: string[] = [];

  // Collect begin/end tokens before offset
  const tokens: { pos: number; kind: 'begin' | 'end'; name: string }[] = [];
  const beginRe = /\\begin\{([^}]+)\}/g;
  const endRe   = /\\end\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = beginRe.exec(source)) !== null) {
    if (m.index < offset) tokens.push({ pos: m.index, kind: 'begin', name: m[1] });
  }
  while ((m = endRe.exec(source)) !== null) {
    if (m.index < offset) tokens.push({ pos: m.index, kind: 'end', name: m[1] });
  }
  tokens.sort((a, b) => a.pos - b.pos);

  for (const t of tokens) {
    const current = stack[stack.length - 1];
    if (current && VERBATIM_ENV_NAMES.has(current) && (t.kind !== 'end' || t.name !== current)) continue;
    if (t.kind === 'begin') stack.push(t.name);
    else {
      const idx = stack.lastIndexOf(t.name);
      if (idx >= 0) stack.splice(idx, 1);
    }
  }
  return stack;
}

function checkCommandArg(before: string): boolean {
  let braces = 0;
  let brackets = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const char = before[i];
    if (char === '}') braces++;
    else if (char === ']') brackets++;
    else if (char === '{') {
      if (braces > 0) braces--;
      else if (/\\[a-zA-Z]+\*?\s*$/.test(before.slice(0, i))) return true;
    } else if (char === '[') {
      if (brackets > 0) brackets--;
      else if (/\\[a-zA-Z]+\*?\s*$/.test(before.slice(0, i))) return true;
    }
  }
  return false;
}

// -- Selection eligibility -------------------------------------------------

export type SelectionAnalysis = {
  eligible: boolean;
  reason?: string;
  protectedTokens: { placeholder: string; original: string }[];
  maskedSelection: string;
};

export function selectionCutsWord(before: string, selected: string, after: string): boolean {
  const word = /[\p{L}\p{N}]/u;
  return (word.test(before.slice(-1)) && word.test(selected.slice(0, 1))) ||
    (word.test(selected.slice(-1)) && word.test(after.slice(0, 1)));
}

const PLACEHOLDER_PREFIX = '@@PROTECTED_';

export function analyzeSelection(selectedText: string, context: ScanContext): SelectionAnalysis {
  if (selectedText.length === 0) {
    return { eligible: false, reason: 'Empty selection', protectedTokens: [], maskedSelection: '' };
  }
  if (!context.isInDocument || context.isInPreamble) {
    return { eligible: false, reason: 'Selection is in preamble (outside \\begin{document})', protectedTokens: [], maskedSelection: '' };
  }
  if (context.isInMath) {
    return { eligible: false, reason: 'Selection is inside math mode', protectedTokens: [], maskedSelection: '' };
  }
  if (context.isInVerbatim) {
    return { eligible: false, reason: 'Selection is inside a verbatim-like environment', protectedTokens: [], maskedSelection: '' };
  }
  if (context.isInComment) {
    return { eligible: false, reason: 'Selection is inside a comment', protectedTokens: [], maskedSelection: '' };
  }
  if (context.isInCommandName || context.isInCommandArg) {
    return { eligible: false, reason: 'Selection includes or is inside a LaTeX command', protectedTokens: [], maskedSelection: '' };
  }
  if (/\\(?:begin|end)\{document\}|\\(?:section|subsection|chapter|part)\b/.test(selectedText)) {
    return { eligible: false, reason: 'Selection contains a structural LaTeX command', protectedTokens: [], maskedSelection: '' };
  }
  if (selectedText.split('\n').some(line => findCommentStart(line) >= 0)) {
    return { eligible: false, reason: 'Selection contains a LaTeX comment', protectedTokens: [], maskedSelection: '' };
  }
  if (selectedText.includes(PLACEHOLDER_PREFIX)) {
    return { eligible: false, reason: 'Selection contains a reserved placeholder', protectedTokens: [], maskedSelection: '' };
  }

  // Check for unbalanced braces
  let open = 0;
  for (const ch of selectedText) {
    if (ch === '{') open++;
    if (ch === '}') open--;
    if (open < 0) break;
  }
  if (open !== 0) {
    return { eligible: false, reason: 'Unbalanced braces in selection', protectedTokens: [], maskedSelection: '' };
  }

  // Extract and mask protected tokens
  const protectedTokens: { placeholder: string; original: string }[] = [];
  let masked = selectedText;

  for (const pattern of PROTECTED_PATTERNS) {
    masked = masked.replace(pattern, (match: string) => {
      const placeholder = `${PLACEHOLDER_PREFIX}${protectedTokens.length}__`;
      protectedTokens.push({ placeholder, original: match });
      return placeholder;
    });
  }

  if (/[{}]/.test(masked)) {
    return { eligible: false, reason: 'Selection contains unsupported nested braces', protectedTokens: [], maskedSelection: '' };
  }
  if (!/[\p{L}\p{N}]/u.test(masked.replace(/@@PROTECTED_\d+__/g, ''))) {
    return { eligible: false, reason: 'Select prose as well as LaTeX tokens', protectedTokens: [], maskedSelection: '' };
  }

  return { eligible: true, protectedTokens, maskedSelection: masked };
}

// -- Placeholder restore & verify ------------------------------------------

export function verifyAndRestore(
  _maskedRequest: string,
  modelResponse: string,
  protectedTokens: { placeholder: string; original: string }[],
): { success: true; restored: string } | { success: false; reason: string } {
  let restored = modelResponse;

  if (!modelResponse || /```/.test(modelResponse)) {
    return { success: false, reason: 'Invalid AI response' };
  }
  if (protectedTokens.some(token => /\\(?:input|include|usepackage|write)\b/.test(token.original))) {
    return { success: false, reason: 'Protected text contains a dangerous LaTeX command' };
  }

  // Check every placeholder appears exactly once
  for (let i = 0; i < protectedTokens.length; i++) {
    const re = new RegExp(escapeRegex(protectedTokens[i].placeholder), 'g');
    const count = (restored.match(re) || []).length;
    if (count !== 1) {
      return { success: false, reason: `Protected token ${i} appears ${count} times (expected exactly 1) — refusing to restore` };
    }
  }

  // Verify order
  const flatPlaceholders = restored.match(new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}\\d+__`, 'g')) || [];
  if (flatPlaceholders.length !== protectedTokens.length) {
    return { success: false, reason: 'Unexpected protected placeholder' };
  }
  for (let i = 0; i < flatPlaceholders.length; i++) {
    const idx = parseInt(flatPlaceholders[i].slice(PLACEHOLDER_PREFIX.length, -2), 10);
    if (idx !== i) {
      return { success: false, reason: `Protected tokens out of order: expected ${i}, got ${idx}` };
    }
  }

  const proseOnly = protectedTokens.reduce((text, token) => text.replace(token.placeholder, ''), modelResponse);
  if (/\\|%/.test(proseOnly)) {
    return { success: false, reason: 'AI response introduced a LaTeX command or comment' };
  }

  // Restore in order
  for (const pt of protectedTokens) {
    restored = restored.replace(pt.placeholder, pt.original);
  }

  return { success: true, restored };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -- Safe text rendering helper --------------------------------------------

export function isSafeText(text: string): boolean {
  return !/[<>]/.test(text);
}

// -- Completion filter -----------------------------------------------------

export type CompletionFilterResult = {
  accepted: boolean;
  reason?: string;
};

export function filterCompletion(
  insertion: string,
  prefix: string,
): CompletionFilterResult {
  if (!insertion || insertion.trim().length === 0) {
    return { accepted: false, reason: 'Empty insertion' };
  }
  if (insertion.length > 200) {
    return { accepted: false, reason: `Insertion exceeds 200 chars (${insertion.length})` };
  }
  // A provider sometimes returns the whole current line instead of an insertion.
  const currentLine = prefix.slice(prefix.lastIndexOf('\n') + 1).trimStart();
  if (currentLine && insertion.trimStart().startsWith(currentLine)) {
    return { accepted: false, reason: 'Insertion repeats existing prefix' };
  }
  if (/```|\r|\n/.test(insertion)) {
    return { accepted: false, reason: 'Insertion is not a short prose continuation' };
  }
  // Reject if it contains a document wrapper
  if (/\\documentclass|\\begin\{document\}|\\end\{document\}/.test(insertion)) {
    return { accepted: false, reason: 'Insertion contains document structure commands' };
  }
  // Reject dangerous commands
  if (/\\|%/.test(insertion)) {
    return { accepted: false, reason: 'Insertion contains unsafe LaTeX command' };
  }
  // Reject if it removes text (must be purely additive)
  if (insertion.length < 3 && insertion.trim() === '') {
    return { accepted: false, reason: 'Insertion is too short' };
  }
  return { accepted: true };
}

// -- Unsupported selection reason builder -----------------------------------

export function describeUnsupportedSelection(context: ScanContext): string {
  if (context.isInPreamble) return 'Selection is in the preamble — paraphrase is only available inside \\begin{document}';
  if (context.isInMath) return 'Selection is inside math mode — paraphrase is not available for equations or math expressions';
  if (context.isInVerbatim) return 'Selection is inside a verbatim environment — paraphrase is not available';
  if (context.isInComment) return 'Selection is inside a comment — paraphrase is not available for commented text';
  if (context.isInCommandName || context.isInCommandArg) return 'Selection includes or is inside a LaTeX command — please select only prose text';
  if (!context.isInDocument) return 'Paraphrase is only available for text inside \\begin{document}';
  return 'Selection is not eligible for paraphrase';
}
