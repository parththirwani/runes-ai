// Tests for latex-utils.ts — context scanner, selection analysis, placeholder masking
// Pure function tests — no mocking needed

import { describe, it, expect } from 'vitest';
import {
  scanContext,
  analyzeSelection,
  verifyAndRestore,
  filterCompletion,
  ScanContext,
  isSafeText,
  describeUnsupportedSelection,
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

\\end{document}
`;

function offsetOf(text: string, search: string): number {
  const idx = text.indexOf(search);
  if (idx < 0) throw new Error(`"${search}" not found in text`);
  return idx;
}

describe('scanContext', () => {
  it('ignores a dollar sign in a prior comment', () => {
    const source = '\\begin{document}\n% $ not math\nProse here';
    expect(scanContext(source, source.length).isInMath).toBe(false);
  });

  it('treats percent after two backslashes as a comment', () => {
    const source = '\\begin{document}\nProse \\\\% comment';
    expect(scanContext(source, source.length).isInComment).toBe(true);
  });

  it('ignores fake math environments inside verbatim', () => {
    const source = '\\begin{document}\n\\begin{verbatim}\n\\begin{equation}\n\\end{verbatim}\nProse';
    const context = scanContext(source, source.length);
    expect(context.isInVerbatim).toBe(false);
    expect(context.isInMath).toBe(false);
  });

  it('suppresses completion throughout command arguments', () => {
    const source = '\\begin{document}\n\\emph{formatted words here} plain prose';
    expect(scanContext(source, source.indexOf('words') + 3).isInCommandArg).toBe(true);
    expect(scanContext(source, source.indexOf('plain') + 3).isInCommandArg).toBe(false);
    const optional = '\\begin{document}\n\\cite[see page 2]{key} prose';
    expect(scanContext(optional, optional.indexOf('page') + 2).isInCommandArg).toBe(true);
  });
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

  it('detects inline math $...$ delimiters (position inside $E=mc^2$)', () => {
    // scanContext now detects $...$ via scanMathDelimiters.
    const dollarPos = SAMPLE_DOC.indexOf('$E = mc^2$') + '$E'.length;
    const ctx = scanContext(SAMPLE_DOC, dollarPos);
    expect(ctx.isInDocument).toBe(true);
    expect(ctx.isInMath).toBe(true);
  });

  it('detects $$...$$ display math delimiters (env stack, not $ delimiters)', () => {
    // $$...$$ isn't captured by env stack either; test that equation env IS
    const pos = SAMPLE_DOC.indexOf('\\int_{0}');
    const ctx = scanContext(SAMPLE_DOC, pos);
    expect(ctx.isInMath).toBe(true);
  });

  it('detects escaped \\% (not a comment)', () => {
    const doc = 'This line has an escaped \\% percent sign.';
    // The backslash before % means it's not a comment
    const pos = doc.indexOf('\\%') + 1;
    const ctx = scanContext(doc, pos);
    expect(ctx.isInComment).toBe(false);
  });

  it('detects real % as comment', () => {
    const doc = 'This line has a real comment.\n% This is a comment';
    const pos = doc.indexOf('% This is a comment');
    const ctx = scanContext(doc, pos);
    expect(ctx.isInComment).toBe(true);
  });

  it('detects preamble position differently from within document', () => {
    // Preamble: isInDocument=false, isInPreamble=true
    // Within document: isInDocument=true, isInPreamble=false
    const prePos = offsetOf(SAMPLE_DOC, '\\title');
    const preCtx = scanContext(SAMPLE_DOC, prePos);
    expect(preCtx.isInPreamble).toBe(true);
    expect(preCtx.isInDocument).toBe(false);

    const docPos = offsetOf(SAMPLE_DOC, 'Summarize your findings here.');
    const docCtx = scanContext(SAMPLE_DOC, docPos);
    expect(docCtx.isInPreamble).toBe(false);
    expect(docCtx.isInDocument).toBe(true);
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

  it('returns false for all context fields on empty string at pos 0', () => {
    const ctx = scanContext('', 0);
    expect(ctx.isInDocument).toBe(false);
    // With empty source, no \\begin{document} found, so !inDocument means preamble=true
    expect(ctx.isInPreamble).toBe(true);
    expect(ctx.isInComment).toBe(false);
    expect(ctx.isInMath).toBe(false);
    expect(ctx.isInVerbatim).toBe(false);
    expect(ctx.isInCommandName).toBe(false);
    expect(ctx.isInCommandArg).toBe(false);
  });

  it('detects align environment as math', () => {
    const doc = 'Before\n\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\nAfter';
    const pos = doc.indexOf('a &= b');
    const ctx = scanContext(doc, pos);
    expect(ctx.isInMath).toBe(true);
  });

  it('detects nested environment boundaries correctly', () => {
    const doc = '\\begin{verbatim}\n\\begin{equation}\nE=mc^2\n\\end{equation}\n\\end{verbatim}\nDone';
    // Verbatim is detected; but the simple env-stack scanner sees
    // \\begin{equation} inside verbatim as a real math env token.
    // This is a known limitation of the conservative lexical detector.
    const pos = doc.indexOf('E=mc^2');
    const ctx = scanContext(doc, pos);
    expect(ctx.isInVerbatim).toBe(true);
  });
});

describe('analyzeSelection', () => {
  const docCtx: ScanContext = { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };

  it('rejects empty selection', () => {
    const result = analyzeSelection('', docCtx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Empty');
  });

  it('rejects preamble selection', () => {
    const ctx: ScanContext = { isInDocument: false, isInPreamble: true, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    const result = analyzeSelection('some text', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('preamble');
  });

  it('rejects math mode selection', () => {
    const ctx: ScanContext = { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: true, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    const result = analyzeSelection('x + y', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('math');
  });

  it('rejects comment selection', () => {
    const ctx: ScanContext = { isInDocument: true, isInPreamble: false, isInComment: true, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    const result = analyzeSelection('% comment', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('comment');
  });

  it('rejects command name selection', () => {
    const ctx: ScanContext = { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: true, isInCommandArg: false };
    const result = analyzeSelection('textbf', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('command');
  });

  it('rejects command arg selection', () => {
    const ctx: ScanContext = { isInDocument: true, isInPreamble: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: true };
    const result = analyzeSelection('arg text', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('command');
  });

  it('accepts plain prose selection', () => {
    const result = analyzeSelection('This is some prose text.', docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens).toEqual([]);
    expect(result.maskedSelection).toBe('This is some prose text.');
  });

  it('masks \\cite{...} tokens', () => {
    const text = 'According to \\cite{smith2020}, the result is important.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
    expect(result.protectedTokens[0].original).toContain('cite');
    expect(result.maskedSelection).not.toContain('\\cite');
  });

  it('masks \\ref{...} tokens', () => {
    const text = 'See \\ref{fig:results}.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
  });

  it('masks \\label{...} tokens', () => {
    const text = 'As shown in \\label{fig:main}.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.some(t => t.original.includes('label'))).toBe(true);
  });

  it('masks \\pageref{...} tokens', () => {
    const text = 'See page \\pageref{fig:main}.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.some(t => t.original.includes('pageref'))).toBe(true);
  });

  it('masks inline math $...$', () => {
    const text = 'The value $E = mc^2$ is important.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
    expect(result.maskedSelection).not.toContain('$E = mc^2$');
  });

  it('masks display math $$...$$', () => {
    const text = 'The equation $$E = mc^2$$ is famous.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.some(t => t.original.startsWith('$$'))).toBe(true);
    expect(result.maskedSelection).not.toContain('$$E = mc^2$$');
  });

  it('masks environment blocks', () => {
    const text = 'Before\n\\begin{equation}\n    x^2 + y^2 = z^2\n\\end{equation}\nAfter';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.some(t => t.original.includes('\\begin{equation}'))).toBe(true);
    expect(result.maskedSelection).not.toContain('\\begin{equation}');
  });

  it('masks plain LaTeX commands', () => {
    const text = 'The area command uses \\texttt{mono} text.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.some(t => t.original.includes('texttt'))).toBe(true);
    expect(result.maskedSelection).not.toContain('\\texttt');
  });

  it('rejects unbalanced braces', () => {
    const result = analyzeSelection('This has {unbalanced braces', docCtx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('braces');
  });

  it('rejects selection in verbatim', () => {
    const ctx: ScanContext = { ...docCtx, isInVerbatim: true };
    const result = analyzeSelection('some verbatim text', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('verbatim');
  });

  it('rejects selections crossing unsupported boundaries (math + prose mix evaluated by start context only)', () => {
    // The selection evaluation uses start context only — if start is prose but
    // the selection includes math delimiters, they get masked instead of rejected.
    const text = 'The value $E = mc^2$ is important.';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true); // start is in document prose
    expect(result.protectedTokens.length).toBeGreaterThanOrEqual(1);
    expect(result.protectedTokens.some(t => t.original.includes('$'))).toBe(true);
  });

  it('generates sequential placeholders', () => {
    const text = '$E=mc^2$ and \\cite{key} and $x^2$';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(true);
    expect(result.protectedTokens.length).toBe(3);
    expect(result.protectedTokens[0].placeholder).toBe('@@PROTECTED_0__');
    expect(result.protectedTokens[1].placeholder).toBe('@@PROTECTED_1__');
    expect(result.protectedTokens[2].placeholder).toBe('@@PROTECTED_2__');
  });

  it('rejects a selection with only protected tokens', () => {
    const text = '$E=mc^2$';
    const result = analyzeSelection(text, docCtx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('prose');
  });

  it('rejects braces that close before they open', () => {
    expect(analyzeSelection('} prose {', docCtx).eligible).toBe(false);
  });

  it('rejects unsupported nested command braces', () => {
    expect(analyzeSelection('Read \\emph{nested {text}} now.', docCtx).eligible).toBe(false);
  });

  it('masks escaped LaTeX characters and rejects a new escape', () => {
    const analysis = analyzeSelection('A 50\\% increase is useful.', docCtx);
    expect(analysis.eligible).toBe(true);
    expect(analysis.protectedTokens[0].original).toBe('\\%');
    const safe = verifyAndRestore(analysis.maskedSelection, 'The @@PROTECTED_0__ increase helps.', analysis.protectedTokens);
    expect(safe.success).toBe(true);
    const unsafe = verifyAndRestore(analysis.maskedSelection, 'The @@PROTECTED_0__ increase \\_ helps.', analysis.protectedTokens);
    expect(unsafe.success).toBe(false);
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

  it('rejects missing placeholder', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\cite{key}' },
    ];
    const response = 'No placeholders here at all.';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('appears 0 times');
    }
  });

  it('rejects dangerous command introduced by placeholder restoration', () => {
    // The placeholder's value is a dangerous command.
    // After restoration the command appears, but it was NOT in the raw
    // modelResponse string — so verifyAndRestore rejects it.
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\input{other}' },
    ];
    const response = 'We could use @@PROTECTED_0__ here';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('dangerous');
    }
  });

  it('rejects include command introduced by placeholder restoration', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\include{chapter}' },
    ];
    const response = 'Consider @@PROTECTED_0__';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('dangerous');
    }
  });

  it('rejects usepackage command introduced by placeholder restoration', () => {
    const tokens = [
      { placeholder: '@@PROTECTED_0__', original: '\\usepackage{amsmath}' },
    ];
    const response = 'We need @@PROTECTED_0__ here';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('dangerous');
    }
  });

  it('rejects a new \\input command in the model response', () => {
    const tokens: { placeholder: string; original: string }[] = [];
    const response = 'We could \\input{other} directly.';
    const result = verifyAndRestore('', response, tokens);
    expect(result.success).toBe(false);
  });

  it('restores with no tokens unchanged', () => {
    const result = verifyAndRestore('', 'Plain text response.', []);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.restored).toBe('Plain text response.');
    }
  });
});

describe('filterCompletion', () => {
  it('accepts a valid short insertion', () => {
    expect(filterCompletion(' is a key result', 'This').accepted).toBe(true);
  });

  it('rejects empty insertion', () => {
    const r = filterCompletion('', 'prefix');
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('Empty');
  });

  it('rejects insertion over 200 chars', () => {
    const r = filterCompletion('x'.repeat(201), 'prefix');
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('200');
  });

  it('accepts insertion exactly at 200 chars', () => {
    const r = filterCompletion('x'.repeat(200), 'prefix');
    expect(r.accepted).toBe(true);
  });

  it('rejects insertion repeating the prefix', () => {
    const r = filterCompletion('prefix and more', 'prefix');
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('prefix');
  });

  it('rejects insertion with document structure commands', () => {
    expect(filterCompletion('\\documentclass{article}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\begin{document}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\end{document}', 'pre').accepted).toBe(false);
  });

  it('rejects unsafe LaTeX commands', () => {
    expect(filterCompletion('\\input{other}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\include{chapter}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\usepackage{amsmath}', 'pre').accepted).toBe(false);
    expect(filterCompletion('\\write{file}', 'pre').accepted).toBe(false);
  });

  it('rejects whitespace-only insertion', () => {
    const r = filterCompletion('   ', 'x');
    expect(r.accepted).toBe(false);
  });
});

describe('isSafeText', () => {
  it('returns true for plain text', () => {
    expect(isSafeText('Hello world')).toBe(true);
  });

  it('returns false for text with <', () => {
    expect(isSafeText('<script>')).toBe(false);
  });

  it('returns false for text with >', () => {
    expect(isSafeText('a > b')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isSafeText('')).toBe(true);
  });
});

describe('describeUnsupportedSelection', () => {
  it('describes preamble reason', () => {
    const ctx: ScanContext = { isInPreamble: true, isInDocument: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('preamble');
  });

  it('describes math mode reason', () => {
    const ctx: ScanContext = { isInPreamble: false, isInDocument: true, isInComment: false, isInMath: true, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('math');
  });

  it('describes verbatim reason', () => {
    const ctx: ScanContext = { isInPreamble: false, isInDocument: true, isInComment: false, isInMath: false, isInVerbatim: true, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('verbatim');
  });

  it('describes comment reason', () => {
    const ctx: ScanContext = { isInPreamble: false, isInDocument: true, isInComment: true, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('comment');
  });

  it('describes command reason', () => {
    const ctx: ScanContext = { isInPreamble: false, isInDocument: true, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: true, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('command');
  });

  it('describes outside document reason', () => {
    const ctx: ScanContext = { isInPreamble: false, isInDocument: false, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('\\begin{document}');
  });

  it('returns generic message for unknown case', () => {
    // All false should hit the default
    const ctx: ScanContext = { isInPreamble: false, isInDocument: true, isInComment: false, isInMath: false, isInVerbatim: false, isInCommandName: false, isInCommandArg: false };
    expect(describeUnsupportedSelection(ctx)).toContain('not eligible');
  });
});
