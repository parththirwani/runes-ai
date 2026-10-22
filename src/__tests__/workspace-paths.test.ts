import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  WorkspacePathError,
  assertSafeWorkspacePath,
  buildTree,
  kindForPath,
  normalizeWorkspacePath,
  pathsCollide,
  resolveInsideDirectory,
} from '@/src/lib/workspace-paths';

const reject = (input: string) => expect(() => normalizeWorkspacePath(input)).toThrow(WorkspacePathError);

describe('workspace path validation', () => {
  it('accepts ordinary nested workspace paths', () => {
    expect(normalizeWorkspacePath('main.tex')).toBe('main.tex');
    expect(normalizeWorkspacePath('chapters/methods.tex')).toBe('chapters/methods.tex');
    expect(normalizeWorkspacePath('figures/plot-2.png')).toBe('figures/plot-2.png');
    expect(normalizeWorkspacePath('  main.tex  ')).toBe('main.tex');
  });

  it('rejects traversal in every spelling tried', () => {
    const fullWidthDot = String.fromCharCode(0xff0e); // normalises onto "." under NFKC
    const rtlOverride = String.fromCharCode(0x202e);

    reject('../secret.tex');
    reject('../../secret.tex');
    reject('chapters/../../secret.tex');
    reject('./../secret.tex');
    reject('..\\secret.tex');
    reject('chapters\\..\\..\\etc/passwd');
    reject('..%2f..%2fsecret.tex');
    reject(fullWidthDot + fullWidthDot + '/secret.tex');
    reject('figures/' + rtlOverride + 'tex/plot.png');
  });

  it('rejects absolute paths and drive letters', () => {
    reject('/etc/passwd');
    reject('/main.tex');
    reject('C:/Windows/system32');
    reject('\\\\server\\share\\file.tex');
  });

  it('rejects control characters, empty segments and over-long paths', () => {
    reject('main\u0000.tex');
    reject('main\u0007.tex');
    reject('chapters//methods.tex');
    reject('chapters/');
    reject('/');
    reject('');
    reject('a'.repeat(400) + '.tex');
    reject(Array.from({ length: 20 }, () => 'dir').join('/') + '/main.tex');
  });

  it('rejects names that only differ by case as collisions', () => {
    expect(pathsCollide('Chapters/Methods.tex', 'chapters/methods.tex')).toBe(true);
    expect(pathsCollide('a.tex', 'b.tex')).toBe(false);
  });

  it('classifies kinds by extension', () => {
    expect(kindForPath('main.tex')).toBe('tex');
    expect(kindForPath('refs.bib')).toBe('bib');
    expect(kindForPath('figures/plot.PNG')).toBe('image');
    expect(kindForPath('notes.txt')).toBe('other');
  });

  it('refuses unsupported file types', () => {
    expect(() => assertSafeWorkspacePath('payload.exe')).toThrow(/Unsupported file type/);
    expect(() => assertSafeWorkspacePath('main.sh')).toThrow(WorkspacePathError);
    expect(() => assertSafeWorkspacePath('.hidden')).toThrow(WorkspacePathError);
    expect(assertSafeWorkspacePath('refs.bib')).toBe('refs.bib');
  });

  it('keeps resolved paths inside the job directory', () => {
    const base = '/tmp/runes-job-1';
    expect(resolveInsideDirectory(base, 'chapters/methods.tex')).toBe('/tmp/runes-job-1/chapters/methods.tex');
    expect(() => resolveInsideDirectory(base, '../escape.tex')).toThrow(WorkspacePathError);
    expect(() => resolveInsideDirectory(base, 'a/../../escape.tex')).toThrow(WorkspacePathError);
  });

  it('documents the configured limits', () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('buildTree', () => {
  it('builds real folders from flat paths', () => {
    const tree = buildTree(['main.tex', 'chapters/methods.tex', 'chapters/deep/nested.tex', 'figures/plot.png']);
    expect(tree.map((node) => node.name)).toEqual(['chapters', 'figures', 'main.tex']);
    const chapters = tree[0];
    expect(chapters.type).toBe('directory');
    expect(chapters.children?.map((node) => node.name)).toEqual(['deep', 'methods.tex']);
  });

  it('handles an empty workspace', () => {
    expect(buildTree([])).toEqual([]);
  });
});
