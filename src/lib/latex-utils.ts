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
];

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

  // Comment detection
  const lastNewline = before.lastIndexOf('\n');
  const linePrefix = before.slice(lastNewline + 1);
  const commentIdx = linePrefix.indexOf('%');
  const inComment = commentIdx >= 0;

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
  const envStack = scanEnvStack(fullSource, offset);
  const inMath = envStack.some(e => MATH_ENV_NAMES.has(e));
  const inVerbatim = envStack.some(e => VERBATIM_ENV_NAMES.has(e));

  // Command name check
  const precedingText = before.slice(Math.max(0, before.length - 100));
  const cmdMatch = precedingText.match(/(\\(?:[a-zA-Z]+))$/);
  const inCommandName = cmdMatch !== null && offset >= (before.length - cmdMatch[0].length) && offset < before.length;
  const inCommandArg = checkCommandArg(before);

  return { isInDocument: inDocument && !pastDocEnd, isInPreamble: inPreamble, isInComment: inComment, isInMath: inMath, isInVerbatim: inVerbatim, isInCommandName: inCommandName, isInCommandArg: inCommandArg };
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
    if (t.kind === 'begin') stack.push(t.name);
    else {
      const idx = stack.lastIndexOf(t.name);
      if (idx >= 0) stack.splice(idx, 1);
    }
  }
  return stack;
}

function checkCommandArg(before: string): boolean {
  const trimmed = before.replace(/\s+$/, '');
  if (trimmed.endsWith('}')) {
    let depth = 0;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i] === '}') depth++;
      else if (trimmed[i] === '{') {
        depth--;
        if (depth === 0) return /\\([a-zA-Z]+)\s*\{[^}]*$/.test(trimmed.slice(0, i + 1));
      }
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

  // Check for unbalanced braces
  let open = 0;
  for (const ch of selectedText) {
    if (ch === '{') open++;
    if (ch === '}') open--;
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

  return { eligible: true, protectedTokens, maskedSelection: masked };
}

// -- Placeholder restore & verify ------------------------------------------

export function verifyAndRestore(
  maskedRequest: string,
  modelResponse: string,
  protectedTokens: { placeholder: string; original: string }[],
): { success: true; restored: string } | { success: false; reason: string } {
  let restored = modelResponse;

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
  for (let i = 0; i < flatPlaceholders.length; i++) {
    const idx = parseInt(flatPlaceholders[i].slice(PLACEHOLDER_PREFIX.length, -2), 10);
    if (idx !== i) {
      return { success: false, reason: `Protected tokens out of order: expected ${i}, got ${idx}` };
    }
  }

  // Restore in order
  for (const pt of protectedTokens) {
    restored = restored.replace(pt.placeholder, pt.original);
  }

  // Reject dangerous commands that weren't in the model's raw response
  const dangerousCommands = ['\\input{', '\\include{', '\\usepackage{', '\\write{'];
  for (const cmd of dangerousCommands) {
    if (restored.includes(cmd) && !modelResponse.includes(cmd)) {
      return { success: false, reason: `Model introduced dangerous LaTeX command: ${cmd}` };
    }
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
  // Reject if it repeats the prefix verbatim
  if (insertion.startsWith(prefix)) {
    return { accepted: false, reason: 'Insertion repeats existing prefix' };
  }
  // Reject if it contains a document wrapper
  if (/\\documentclass|\\begin\{document\}|\\end\{document\}/.test(insertion)) {
    return { accepted: false, reason: 'Insertion contains document structure commands' };
  }
  // Reject dangerous commands
  if (/\\input\{|\\include\{|\\usepackage\{|\\write\{/.test(insertion)) {
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