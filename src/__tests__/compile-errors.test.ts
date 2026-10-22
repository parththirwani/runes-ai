import { describe, expect, it } from 'vitest';
import { errorExcerpt, formatCompileError, parseCompileErrors } from '@/src/lib/compile-errors';

const KNOWN = ['main.tex', 'chapters/methods.tex', 'chapters/broken.tex', 'figures/plot.png'];

describe('compile error mapping', () => {
  it('maps a tectonic error to the workspace file and line', () => {
    const output = [
      'note: Running TeX ...',
      'error: chapters/broken.tex:7: Undefined control sequence.',
      'error: chapters/broken.tex:9: Missing $ inserted.',
    ].join('\n');

    const diagnostics = parseCompileErrors(output, KNOWN, 'main.tex');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({ file: 'chapters/broken.tex', line: 7 });
    expect(diagnostics[1]).toMatchObject({ file: 'chapters/broken.tex', line: 9, message: 'Missing $ inserted.' });
  });

  it('attributes a bare LaTeX error to the file TeX was reading', () => {
    const output = ['(./chapters/methods.tex', "! LaTeX Error: Environment.qeubre undefined."].join('\n');
    const diagnostics = parseCompileErrors(output, KNOWN, 'main.tex');
    expect(diagnostics[0].file).toBe('chapters/methods.tex');
  });

  it('never leaks the job directory into a diagnostic', () => {
    const output = 'error: /tmp/runes-compile/job-9/main.tex:3: Bad box.';
    const diagnostics = parseCompileErrors(output, KNOWN, 'main.tex');
    for (const diagnostic of diagnostics) {
      expect(diagnostic.file === null || !diagnostic.file.startsWith('/')).toBe(true);
      expect(diagnostic.message).not.toContain('/tmp/runes-compile');
    }
  });

  it('falls back to a readable message when the engine says nothing usable', () => {
    expect(formatCompileError([], 'The engine exited without producing a PDF')).toBe('The engine exited without producing a PDF');
    const diagnostics = parseCompileErrors('some random noise', KNOWN, 'main.tex');
    expect(diagnostics).toEqual([]);
  });

  it('formats the first diagnostics with path and line for the editor', () => {
    const text = formatCompileError([{ file: 'chapters/broken.tex', line: 7, message: 'Undefined control sequence.' }], 'unused');
    expect(text).toBe('chapters/broken.tex:7: Undefined control sequence.');
  });

  it('bounds the raw log excerpt it sends to the browser', () => {
    const long = Array.from({ length: 500 }, (_, i) => 'line ' + i).join('\n');
    const excerpt = errorExcerpt(long);
    expect(excerpt.split('\n').length).toBeLessThanOrEqual(40);
    expect(excerpt).toContain('line 499');
  });
});
