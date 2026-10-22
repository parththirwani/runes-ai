import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { buildReferenceClosure, extractReferences, resolveReference, snapshotDigest, type CompilerSettings, type SnapshotManifest } from '@/src/lib/latex-snapshot';

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const compiler: CompilerSettings = { engine: 'direct', engineVersion: 'tectonic 0.15.0', mainFile: 'main.tex', options: ['--untrusted'] };

function manifest(mainFile: string, files: { path: string; checksum: string; revision: number }[]): SnapshotManifest {
  return { version: 1, documentId: 'doc-1', userId: 'user-1', mainFile, compiler, files };
}

describe('reference extraction', () => {
  it('finds inputs, includes, graphics and bibliography targets', () => {
    const source = [
      '\\input{chapters/methods}',
      '\\include{chapters/results}',
      '\\includegraphics[width=0.5\\textwidth]{figures/plot.png}',
      '\\bibliography{refs,additional}',
      '% \\input{commented.out}',
      'Text with an escaped percent \\% then \\input{appendix}.',
    ].join('\n');

    const targets = extractReferences('main.tex', source).map((reference) => reference.raw);
    // Document order, so a missing-file message names the first problem a reader sees.
    expect(targets).toEqual([
      'chapters/methods',
      'chapters/results',
      'figures/plot.png',
      'refs',
      'additional',
      'appendix',
    ]);
  });

  it('adds the .tex extension when resolving a bare include', () => {
    const resolved = resolveReference({ from: 'main.tex', raw: 'chapters/methods', command: 'input' }, ['chapters/methods.tex', 'main.tex']);
    expect(resolved).toBe('chapters/methods.tex');
  });

  it('searches the workspace root first, then the referencing file folder', () => {
    // TeX resolves against the job root, so a root file wins when both exist.
    const both = ['chapters/details.tex', 'details.tex'];
    expect(resolveReference({ from: 'chapters/methods.tex', raw: 'details', command: 'input' }, both)).toBe('details.tex');

    // A nested-only file still resolves from the file that references it.
    const nestedOnly = ['chapters/methods.tex', 'chapters/details.tex'];
    expect(resolveReference({ from: 'chapters/methods.tex', raw: 'details', command: 'input' }, nestedOnly)).toBe('chapters/details.tex');
  });

  it('tries known image extensions for includegraphics', () => {
    expect(resolveReference({ from: 'chapters/results.tex', raw: 'figures/plot', command: 'includegraphics' }, ['figures/plot.png'])).toBe('figures/plot.png');
  });

  it('refuses absolute and escaping targets instead of silently resolving them', () => {
    const available = ['main.tex', 'etc/passwd.tex'];
    expect(resolveReference({ from: 'main.tex', raw: '/etc/passwd', command: 'input' }, available)).toBeNull();
    expect(resolveReference({ from: 'main.tex', raw: '../outside', command: 'input' }, ['outside.tex'])).toBeNull();
  });
});

describe('reference closure', () => {
  const sources = new Map<string, string>([
    ['main.tex', '\\input{chapters/methods}\n\\input{chapters/results}\n'],
    ['chapters/methods.tex', '\\input{chapters/details}\n'],
    ['chapters/details.tex', 'leaf\n'],
    ['chapters/results.tex', 'results\n'],
    ['notes/scratch.tex', 'never referenced\n'],
  ]);
  const paths = [...sources.keys()];

  it('includes nested files reachable from the main file only', () => {
    const closure = buildReferenceClosure('main.tex', sources, paths);
    expect(closure.paths).toEqual(['chapters/details.tex', 'chapters/methods.tex', 'chapters/results.tex', 'main.tex']);
    expect(closure.paths).not.toContain('notes/scratch.tex');
    expect(closure.missing).toEqual([]);
  });

  it('reports a missing include with the file that referenced it', () => {
    const withMissing = new Map([...sources, ['main.tex', '\\input{chapters/methods}\n\\input{chapters/gone}\n']]);
    const closure = buildReferenceClosure('main.tex', withMissing, [...paths, 'main.tex']);
    expect(closure.missing).toMatchObject([{ from: 'main.tex', raw: 'chapters/gone', command: 'input' }]);
  });

  it('reports a missing image separately from unresolvable paths', () => {
    const closure = buildReferenceClosure('main.tex', new Map([['main.tex', '\\includegraphics{figures/none.png}\n']]), ['main.tex']);
    expect(closure.missing).toHaveLength(1);
    expect(closure.unresolved).toHaveLength(0);

    const escaping = buildReferenceClosure('main.tex', new Map([['main.tex', '\\includegraphics{/etc/passwd.png}\n']]), ['main.tex']);
    expect(escaping.unresolved).toHaveLength(1);
  });
});

describe('snapshot digest', () => {
  it('is stable for the same manifest regardless of file order', () => {
    const files = [
      { path: 'main.tex', checksum: 'a', revision: 1 },
      { path: 'chapters/m.tex', checksum: 'b', revision: 2 },
    ];
    expect(snapshotDigest(manifest('main.tex', files), hash)).toBe(
      snapshotDigest(manifest('main.tex', [...files].reverse()), hash),
    );
  });

  it('changes when any input that affects output changes', () => {
    const base = snapshotDigest(manifest('main.tex', [
      { path: 'main.tex', checksum: 'a', revision: 1 },
      { path: 'figures/plot.png', checksum: 'p', revision: 1 },
    ]), hash);

    const edited = snapshotDigest(manifest('main.tex', [
      { path: 'main.tex', checksum: 'a2', revision: 2 },
      { path: 'figures/plot.png', checksum: 'p', revision: 1 },
    ]), hash);

    const renamed = snapshotDigest(manifest('main.tex', [
      { path: 'main.tex', checksum: 'a', revision: 1 },
      { path: 'figures/plot-v2.png', checksum: 'p', revision: 1 },
    ]), hash);

    const moved = snapshotDigest(manifest('main.tex', [
      { path: 'main.tex', checksum: 'a', revision: 1 },
      { path: 'images/plot.png', checksum: 'p', revision: 1 },
    ]), hash);

    const newMain = snapshotDigest(manifest('alternate.tex', [
      { path: 'main.tex', checksum: 'a', revision: 1 },
      { path: 'figures/plot.png', checksum: 'p', revision: 1 },
    ]), hash);

    const newEngine = snapshotDigest({
      ...manifest('main.tex', [
        { path: 'main.tex', checksum: 'a', revision: 1 },
        { path: 'figures/plot.png', checksum: 'p', revision: 1 },
      ]),
      compiler: { ...compiler, engineVersion: 'tectonic 0.16.0' },
    }, hash);

    expect(new Set([edited, renamed, moved, newMain, newEngine].filter((value) => value !== base)).size).toBe(5);
  });
});
