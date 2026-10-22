import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { compilerOptions, compileJobDirectory, configuredEngine, maxPdfBytes } from '@/worker/latex-compiler';
import { createJobDirectory, materializeSnapshot, removeJobDirectory } from '@/worker/snapshot-materialize';
import { checksum } from '@/src/lib/storage';
import { parseCompileErrors } from '@/src/lib/compile-errors';
import type { SnapshotBundle } from '@/src/lib/latex-snapshot';
import { makePng } from '../../scripts/bench/fixtures.mjs';

function tectonicBinary(): string | null {
  const configured = process.env.TECTONIC_BINARY?.trim();
  if (configured) return configured;
  const found = spawnSync('sh', ['-c', 'command -v tectonic'], { encoding: 'utf-8' });
  const pathFromPath = found.status === 0 ? found.stdout.trim() : '';
  return pathFromPath.length > 0 ? pathFromPath : null;
}

const binary = tectonicBinary();

describe('engine configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to the container path that production compose uses', () => {
    delete process.env.TECTONIC_ENGINE;
    delete process.env.TECTONIC_CONTAINER_NAME;
    expect(configuredEngine()).toBe('docker-run');

    process.env.TECTONIC_CONTAINER_NAME = 'runes-ai-tectonic';
    expect(configuredEngine()).toBe('docker-exec');
  });

  it('honours an explicit engine choice', () => {
    process.env.TECTONIC_ENGINE = 'direct';
    expect(configuredEngine()).toBe('direct');
  });

  it('always runs the engine with untrusted input so shell escape stays off', () => {
    const options = compilerOptions();
    expect(options).toContain('--untrusted');
    expect(options).not.toContain('--shell-escape');
    expect(options).toContain('--outdir');
  });

  it('can pin the engine to the warm package cache for offline compiles', () => {
    process.env.TECTONIC_OFFLINE = '1';
    expect(compilerOptions()).toContain('--only-cached');
    delete process.env.TECTONIC_OFFLINE;
    expect(compilerOptions()).not.toContain('--only-cached');
  });

  it('caps how big an accepted PDF may be', () => {
    expect(maxPdfBytes()).toBe(50 * 1024 * 1024);
  });
});

describe.skipIf(!binary)('real Tectonic compilation of a workspace snapshot', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'runes-compile-'));
    process.env.TECTONIC_ENGINE = 'direct';
    process.env.TECTONIC_BINARY = binary!;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const MAIN = [
    '\\documentclass{article}',
    '\\usepackage{graphicx}',
    '\\begin{document}',
    'Main text sees Section~\\ref{sec:methods}.',
    '\\input{chapters/methods}',
    '\\input{chapters/results}',
    '\\end{document}',
    '',
  ].join('\n');
  const METHODS = ['\\section{Methods}\\label{sec:methods}', 'Methods body.', ''].join('\n');
  const RESULTS = [
    '\\section{Results}\\label{sec:results}',
    'Results refers to Section~\\ref{sec:methods} and Figure~\\ref{fig:plot}.',
    '\\begin{figure}[h]\\centering\\includegraphics[width=0.4\\textwidth]{figures/plot.png}\\caption{Plot.}\\label{fig:plot}\\end{figure}',
    '',
  ].join('\n');

  function bundleWith(files: Record<string, string>, png?: Buffer): SnapshotBundle {
    const entries = Object.entries(files);
    return {
      version: 1,
      documentId: 'doc',
      userId: 'user',
      mainFile: 'main.tex',
      compiler: { engine: 'direct', engineVersion: 'test', mainFile: 'main.tex', options: [] },
      files: entries.map(([filePath, content]) => ({ path: filePath, checksum: checksum(Buffer.from(content)), revision: 1 })),
      inline: entries.map(([filePath, content]) => ({ path: filePath, content })),
      ...(png ? { binary: png } : {}),
    } as SnapshotBundle;
  }

  it('compiles nested includes and a figure, and reports no undefined references', async () => {
    const jobDir = await createJobDirectory(root, 'nested');
    const png = makePng(48, 32);
    const bundle = bundleWith({ 'main.tex': MAIN, 'chapters/methods.tex': METHODS, 'chapters/results.tex': RESULTS });
    await materializeSnapshot(bundle, jobDir);
    await fs.mkdir(path.join(jobDir, 'figures'), { recursive: true });
    await fs.writeFile(path.join(jobDir, 'figures/plot.png'), png);

    const outcome = await compileJobDirectory({ jobDir, mainFile: 'main.tex', timeoutMs: 120000, materializeMs: 1 });
    const log = outcome.output;
    await removeJobDirectory(jobDir);

    expect(outcome.success, log).toBe(true);
    expect(outcome.pdfBuffer!.length).toBeGreaterThan(1000);
    // Cross file labels only resolve when the passes settle; TeX warns about anything unresolved.
    expect(log).not.toMatch(/LaTeX Warning: Reference `sec:methods.on page 1 undefined/);
    expect(log).not.toMatch(/LaTeX Warning: Reference `fig:plot.on page 1 undefined/);
    expect(outcome.timings.engineMs).toBeGreaterThan(0);
  }, 180000);

  it('fails with the offending workspace path when a graphic is missing', async () => {
    const jobDir = await createJobDirectory(root, 'missing-figure');
    const bundle = bundleWith({ 'main.tex': MAIN, 'chapters/methods.tex': METHODS, 'chapters/results.tex': RESULTS });
    await materializeSnapshot(bundle, jobDir); // figures/plot.png intentionally absent

    const outcome = await compileJobDirectory({ jobDir, mainFile: 'main.tex', timeoutMs: 120000, materializeMs: 1 });
    await removeJobDirectory(jobDir);

    expect(outcome.success).toBe(false);
    const diagnostics = parseCompileErrors(outcome.output, ['main.tex', 'chapters/methods.tex', 'chapters/results.tex'], 'main.tex');
    expect(outcome.output).toMatch(/plot\.png|not found/i);
    expect(diagnostics.length).toBeGreaterThan(0);
  }, 180000);

  it('reports the file and line for malformed TeX in an included chapter', async () => {
    const jobDir = await createJobDirectory(root, 'bad-tex');
    const broken = '\\section{Broken}\n\\undefinedcommandhere body\n';
    const bundle = bundleWith({ 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\input{chapters/broken}\n\\end{document}\n', 'chapters/broken.tex': broken });
    await materializeSnapshot(bundle, jobDir);

    const outcome = await compileJobDirectory({ jobDir, mainFile: 'main.tex', timeoutMs: 120000, materializeMs: 1 });
    const log = outcome.output;
    await removeJobDirectory(jobDir);

    expect(outcome.success, log).toBe(false);
    const diagnostics = parseCompileErrors(log, ['main.tex', 'chapters/broken.tex'], 'main.tex');
    const brokenDiagnostic = diagnostics.find((diagnostic) => diagnostic.file === 'chapters/broken.tex');
    expect(brokenDiagnostic?.line, log).toBe(2);
  }, 180000);

  it('returns a clean timeout result instead of hanging', async () => {
    const jobDir = await createJobDirectory(root, 'timeout');
    // A file that never closes its group makes TeX wait for input.
    const bundle = bundleWith({ 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\vrule height \\maxdimen width \\maxdimen\n\\end{document}\n' });
    await materializeSnapshot(bundle, jobDir);

    const outcome = await compileJobDirectory({ jobDir, mainFile: 'main.tex', timeoutMs: 1, materializeMs: 1 });
    await removeJobDirectory(jobDir);
    expect(outcome.success).toBe(false);
  }, 60000);
});
