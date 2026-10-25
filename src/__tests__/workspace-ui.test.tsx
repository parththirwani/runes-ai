import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspacePanel from '@/src/app/components/editor/WorkspacePanel';
import FileTabs from '@/src/app/components/editor/FileTabs';
import { buildTree, type WorkspaceFileKind } from '@/src/lib/workspace-paths';
import type { ManagedFile } from '@/src/hooks/useWorkspace';

// WorkspacePanel renders the account menu, which reads the session; these tests are about the
// file tree, so the session is stubbed instead of mounting a provider.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: () => undefined,
}));

const noop = async () => undefined;

function managed(path: string, kind: WorkspaceFileKind, overrides: Partial<ManagedFile> = {}): ManagedFile {
  return {
    path,
    kind,
    revision: 1,
    checksum: 'a'.repeat(64),
    sizeBytes: 128,
    mimeType: kind === 'image' ? 'image/png' : 'text/x-tex',
    content: 'body',
    savedContent: 'body',
    loaded: true,
    binary: kind === 'image',
    ...overrides,
  };
}

const paths = ['main.tex', 'chapters/methods.tex', 'chapters/results.tex', 'figures/plot.png', 'refs.bib'];
const files: Record<string, ManagedFile> = {
  'main.tex': managed('main.tex', 'tex'),
  'chapters/methods.tex': managed('chapters/methods.tex', 'tex', { revision: 4, content: 'draft', savedContent: 'saved' }),
  'chapters/results.tex': managed('chapters/results.tex', 'tex'),
  'figures/plot.png': managed('figures/plot.png', 'image'),
  'refs.bib': managed('refs.bib', 'bib'),
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof WorkspacePanel>> = {}) {
  return renderToStaticMarkup(
    React.createElement(WorkspacePanel, {
      isOpen: true,
      onClose: () => undefined,
      tree: buildTree(paths),
      files,
      mainFilePath: 'main.tex',
      activePath: 'chapters/methods.tex',
      dirtyPaths: ['chapters/methods.tex'],
      stalePaths: ['refs.bib'],
      slug: 'demo-slug',
      onOpenFile: () => undefined,
      onCreateFile: noop,
      onUpload: noop,
      onRename: noop,
      onDelete: noop,
      onChooseMain: noop,
      outline: React.createElement('div', null, 'outline-slot'),
      error: null,
      onDismissError: () => undefined,
      ...overrides,
    })
  );
}

describe('WorkspacePanel', () => {
  it('renders a nested folder tree with every workspace path', () => {
    const html = renderPanel();
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Workspace files"');
    for (const path of paths) expect(html).toContain(path.split('/').pop()!);
    expect(html).toContain('>chapters<');
    expect(html).toContain('>figures<');
    expect(html).toContain('aria-expanded="true"');
  });

  it('marks the main file, the active file, and unsaved or stale files', () => {
    const html = renderPanel();
    expect(html).toContain('aria-label="Main file"');
    expect(html).toContain('aria-label="Unsaved changes"');
    expect(html).toContain('aria-label="Changed since last compile"');
    expect(html).toContain('>Files<');
    expect(html).toContain('>Outline<');
    expect(html).toContain('title="demo-slug"');
  });

  it('surfaces workspace errors with a dismiss action', () => {
    const html = renderPanel({ error: '409 — someone else saved refs.bib first' });
    expect(html).toContain('409');
    expect(html).toContain('refs.bib');
  });

  it('keeps the panel mounted but off-canvas when closed', () => {
    expect(renderPanel({ isOpen: true })).toContain('translate-x-0');
    const html = renderPanel({ isOpen: false });
    expect(html).toContain('-translate-x-full');
  });
});

describe('FileTabs', () => {
  const openPaths = ['main.tex', 'chapters/methods.tex', 'figures/plot.png'];

  function renderTabs(overrides: Partial<React.ComponentProps<typeof FileTabs>> = {}) {
    return renderToStaticMarkup(
      React.createElement(FileTabs, {
        openPaths,
        files,
        activePath: 'chapters/methods.tex',
        mainFilePath: 'main.tex',
        dirtyPaths: ['chapters/methods.tex'],
        onSelect: () => undefined,
        onClose: () => undefined,
        ...overrides,
      })
    );
  }

  it('renders one tab per open file and highlights the active one', () => {
    const html = renderTabs();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('title="chapters/methods.tex"');
    expect(html).toContain('>methods.tex<');
    expect(html).toContain('>plot.png<');
    expect(html).toContain('>binary<');
  });

  it('badges the main file tab and nothing else', () => {
    expect(renderTabs()).toContain('aria-label="Main file"');
    const single = renderTabs({ openPaths: ['chapters/methods.tex'], activePath: 'chapters/methods.tex' });
    expect(single).not.toContain('aria-label="Main file"');
  });

  it('renders nothing when no files are open', () => {
    expect(renderTabs({ openPaths: [] })).toBe('');
  });

  it('is a no-op free of unattached handlers', () => {
    const spy = vi.fn();
    const html = renderTabs({ onSelect: spy, onClose: spy });
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Close chapters/methods.tex"');
  });
});
