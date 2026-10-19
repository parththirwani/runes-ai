// Tests for latex-utils.ts — context scanner, selection analysis, placeholder masking

import { describe, it, expect } from 'vitest';
import {
  scanContext,
  analyzeSelection,
  verifyAndRestore,
  filterCompletion,
  ScanContext,
} from '../lib/latex-utils';

const SAMPLE_DOC = `\\documentclass{article}
\\usepackage{amsmath}

\\title{Test}
\\author{Me}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
This is the introduction section of your document.
It has multiple lines of text.

\\section{Math}
Here is some inline math: $E = mc^2$
And a display equation:
\\begin{equation}
    \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\\end{equation}

\\section{Citations}
According to \\cite{smith2020}, the result is important.
Also see \\ref{fig:results}.

\\begin{verbatim}
This is raw verbatim text
\\end{verbatim}

\\section{Conclusion}
Summarize your findings here.

% This is a comment

\\end{document}`;

// Helper to find offset of a substring
function offsetOf(text: string, search: string): number {
  const idx = text.indexOf(search);
  if (idx < 0) throw new Error(`"${search}" not found in text`);
  return idx;
}

describe('scanContext', () => {
  it('detects preamble (before \\begin{document})', () => {
    const pos = offsetOf(SAMPLE_DOC, '\\title');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInPreamble).toBe(true);
    expect(ctx.isInDocument).toBe(false);
  });

  it('detects inside document', () => {
    const pos = offsetOf(SAMPLE_DOC, 'This is the introduction');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInDocument).toBe(true);
    expect(ctx.isInPreamble).toBe(false);
  });

  it('detects inline math (environment-based, not $ delimiters)', () => {
    // Our scanContext uses environment stack for math detection
    // $...$ inline math is detected by the analyzeSelection/masking layer instead
    // Test that equation environment IS detected
    const pos = SAMPLE_DOC.indexOf('\\int_{0}');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInMath).toBe(true);
  });

  it('detects equation environment', () => {
    const pos = offsetOf(SAMPLE_DOC, '\\int_{0}');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInMath).toBe(true);
  });

  it('detects verbatim environment', () => {
    const pos = offsetOf(SAMPLE_DOC, 'This is raw verbatim');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInVerbatim).toBe(true);
  });

  it('detects comments', () => {
    const pos = offsetOf(SAMPLE_DOC, 'This is a comment');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInComment).toBe(true);
  });

  it('detects cursor inside a command name', () => {
    // Cursor after some command letters — should detect command name
    const doc = 'Then we apply \\textbf{bold} to it.';
    const pos = doc.indexOf('\\textbf') + 4; // after "\\text"
    const ctx = scanContext(doc, pos);
    expect(ctx.isInCommandName).toBe(true);
  });

  it('detects cursor in a command argument', () => {
    const doc = 'Then we apply \\textbf{bold} to it.';
    const bracePos = doc.indexOf('{bold}');
    const ctx = scanContext(doc, bracePos + 1); // inside the braces
    expect(ctx.isInCommandArg).toBe(true);
  });

  it('detects after \\end{document}', () => {
    const endIdx = SAMPLE_DOC.indexOf('\\end{document}');
    const pos = endIdx + '\\end{document}'.length + 5; // well past
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInDocument).toBe(false);
  });
});

describe('analyzeSelection', () => {
  it('rejects empty selection', () => {
    const result = analyzeSelection('', { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Empty');
  });

  it('rejects preamble selection', () => {
    const result = analyzeSelection('some text', { isInDocument: false, isInPreamble: true, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('preamble');
  });

  it('rejects math mode selection', () => {
    const result = analyzeSelection('x + y', { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: true, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('math');
  });

  it('accepts plain prose selection', () => {
    const result = analyzeSelection('This is some prose text.', { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens).toEqual([]);
    expect(result.maskedSelection).toBe('This is some prose text.');
  });

  it('masks \\cite{...} tokens', () => {
    const text = 'According to \\cite{smith2020}, the result is important.';
    const result = analyzeSelection(text, { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
    expect(result.protectedTokens[0].original).toContain('cite');
    expect(result.maskedSelection).not.toContain('\\cite');
  });

  it('masks \\ref{...} tokens', () => {
    const text = 'See \\ref{fig:results}.';
    const result = analyzeSelection(text, { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
  });

  it('masks inline math $...$', () => {
    const text = 'The value $E = mc^2$ is important.';
    const result = analyzeSelection(text, { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
    expect(result.maskedSelection).not.toContain('$E = mc^2$');
  });

  it('rejects unbalanced braces', () => {
    const result = analyzeSelection('This has {unbalanced braces', { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('braces');
  });

  it('rejects selection in verbatim', () => {
    const result = analyzeSelection('some verbatim text', { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: true, isInCommandName: false, isInCommandArg: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('verbatim');
  });
});

describe('verifyAndRestore', () => {
  it('restores placeholders in correct order', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\cite{smith2020}' },
      { placeholder: '@@PROTECTED_1__', original: '$E=mc^2$' },
    ];
    const response = 'As shown in @@PROTECTED_0__, the value @@PROTECTED_1__ is key.';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.restored).toBe('As shown in \\cite{smith2020}, the value $E=mc^2$ is key.');
    }
  });

  it('rejects duplicate placeholder', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\cite{smith2020}' },
    ];
    const response = 'As shown in @@PROTECTED_0__ and @@PROTECTED_0__';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('appears 2 times');
    }
  });

  it('rejects out-of-order placeholders', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: 'first' },
      { placeholder: '@@PROTECTED_1__', original: 'second' },
    ];
    const response = 'Wrong @@PROTECTED_1__ then @@PROTECTED_0__';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
  });
});

describe('filterCompletion', () => {
  it('accepts a valid short insertion', () => {
    expect(filterCompletion(' is a key result', 'This').accepted).toBe(true);
  });

  it('rejects empty insertion', () => {
    expect(filterCompletion('', 'prefix').accepted).toBe(false);
  });

  it('rejects insertion over 200 chars', () => {
    expect(filterCompletion('x'.repeat(201), 'prefix').accepted).toBe(false);
  });

  it('rejects insertion repeating the prefix', () => {
    expect(filterCompletion('prefix and more', 'prefix').accepted).toBe(false);
  });

  it('rejects insertion with document structure commands', () => {
    expect(filterCompletion('\\documentclass{article}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\begin{document}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\input{other}', 'pre').accepted).toBe(false);
  });
});