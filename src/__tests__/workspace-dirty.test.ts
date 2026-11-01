import { describe, expect, it } from 'vitest';
import { dirtyPathsOf, isDirtyFile, type DirtyCheckFile } from '@/src/lib/workspace-dirty';

// The editor marks unsaved work per file, so an accepted AI edit (or any keystroke) in the
// active file can never mark another open file dirty. These cases pin that rule for the
// derivation the tab dots, the save queue and autosave all share.

function file(path: string, overrides: Partial<DirtyCheckFile> = {}): DirtyCheckFile {
  return {
    path,
    content: 'saved bytes',
    savedContent: 'saved bytes',
    loaded: true,
    binary: false,
    ...overrides,
  };
}

describe('dirtyPathsOf', () => {
  it('lists only the file whose own bytes changed while the other open files stay clean', () => {
    const files = {
      'main.tex': file('main.tex', { content: 'accepted AI edit' }),
      'chapters/methods.tex': file('chapters/methods.tex'),
      'refs.bib': file('refs.bib'),
    };
    expect(dirtyPathsOf(files)).toEqual(['main.tex']);
  });

  it('lists each independently edited file and nothing else', () => {
    const files = {
      'main.tex': file('main.tex', { content: 'one' }),
      'chapters/methods.tex': file('chapters/methods.tex', { content: 'two' }),
      'refs.bib': file('refs.bib'),
    };
    expect(dirtyPathsOf(files)).toEqual(['main.tex', 'chapters/methods.tex']);
  });

  it('treats a file undone back to its saved bytes as clean', () => {
    const saved = 'the original paragraph';
    const edited = file('main.md', { content: saved, savedContent: saved });
    const changed = dirtyPathsOf({ 'main.md': { ...edited, content: 'the rewritten paragraph' } });
    expect(changed).toEqual(['main.md']);
    expect(dirtyPathsOf({ 'main.md': { ...edited, content: saved } })).toEqual([]);
  });

  it('never marks a binary asset or a not-yet-loaded file dirty', () => {
    const files = {
      'figures/plot.png': file('figures/plot.png', { binary: true, content: 'bytes', savedContent: '' }),
      'chapters/results.tex': file('chapters/results.tex', { loaded: false, content: '', savedContent: 'stale' }),
    };
    expect(dirtyPathsOf(files)).toEqual([]);
  });

  it('agrees with isDirtyFile for every entry', () => {
    const files = {
      'main.tex': file('main.tex', { content: 'edited' }),
      'refs.bib': file('refs.bib'),
    };
    for (const entry of Object.values(files)) {
      expect(dirtyPathsOf({ [entry.path]: entry }).includes(entry.path)).toBe(isDirtyFile(entry));
    }
  });
});
