import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The library rows come straight from the hook, so the hook is stubbed and the session/router are
// mocked to render the real table markup without a network or DOM.
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: vi.fn() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Ada', email: 'ada@example.test', image: null } }, status: 'authenticated' }),
  signOut: () => undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { useDashboard } from '@/src/hooks/useDashboard';
import DashboardPage from '@/src/app/components/dashboard/dashboardPage';

const noop = () => undefined;

function stubDocuments(documents: unknown[], workspaces: unknown[] = [], selectedWorkspaceId: string | null = null, sidebarDocuments: unknown[] = [], canCreateTeams = false) {
  vi.mocked(useDashboard).mockReturnValue({
    documents,
    loading: false,
    error: null,
    showCreateModal: false,
    showErrorModal: false,
    errorMessage: '',
    isCreating: false,
    setShowCreateModal: noop,
    setShowErrorModal: noop,
    handleCreateDocument: async () => undefined,
    handleDeleteClick: async () => undefined,
    handleFavoriteToggle: async () => undefined,
    workspaces,
    sidebarDocuments,
    canCreateTeams,
    selectedWorkspaceId,
    selectWorkspace: noop,
    createWorkspace: async () => null,
    renameWorkspace: async () => null,
    deleteWorkspace: async () => null,
    refresh: async () => undefined,
  } as ReturnType<typeof useDashboard>);
}

function row(overrides: Record<string, unknown>) {
  return {
    id: 'x',
    title: 'Doc',
    slug: 'doc',
    isFavorite: false,
    format: 'MARKDOWN',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function render() {
  return renderToStaticMarkup(React.createElement(DashboardPage, {}));
}

describe('document library table attribution', () => {
  it('shows named workspaces and their documents without the default personal or all-workspaces rows', () => {
    stubDocuments([], [
      { id: 'ws-own', name: 'Research', kind: 'PERSONAL', isDefault: false, documentCount: 1, access: 'owner', canCreate: true, canRename: true },
      { id: 'ws-default', name: 'Personal', kind: 'PERSONAL', isDefault: true, documentCount: 0, access: 'owner', canCreate: true, canRename: true },
      { id: 'ws-shared', name: 'Shared notes', kind: 'PERSONAL', isDefault: false, documentCount: 2, access: 'viewer', canCreate: false, canRename: false },
    ], null, [{ id: 'doc-1', title: 'Research draft', workspaceId: 'ws-own', updatedAt: '2026-10-25T00:00:00.000Z' }]);
    const html = render();
    expect(html).toContain('aria-label="New workspace"');
    expect(html).toContain('>New document</button>');
    expect(html.indexOf('>Workspaces</button>')).toBeLessThan(html.indexOf('>Documents</button>'));
    expect(html).not.toContain('<select');
    expect(html).not.toContain('All workspaces');
    expect(html).not.toContain('title="Personal"');
    expect(html).toContain('Research draft');
    expect(html).toContain('aria-label="Actions for Research"');
    expect(html).toContain('aria-label="Actions for Research draft"');
    expect(html).toContain('aria-label="Collapse workspaces"');
    expect(html).toContain('aria-label="Collapse Research"');
    expect(html).toContain('aria-label="Collapse documents"');
    expect(html).not.toContain('aria-label="Actions for Shared notes"');
    expect(html).toContain('aria-label="Resize document sidebar"');
    expect(html).toContain('aria-valuemin="260"');
    expect(html).toContain('aria-valuemax="440"');
    expect(html).toContain('--dashboard-sidebar-width:280px');
  });

  it('names the selected workspace in the document view', () => {
    stubDocuments([], [{ id: 'ws-research', name: 'Research', kind: 'PERSONAL', isDefault: false, documentCount: 0, access: 'owner', canCreate: true, canRename: true }], 'ws-research');
    const html = render();
    expect(html).toContain('>Research</h1>');
    expect(html).toContain('Search in Research...');
    expect(html).toContain('No documents in Research yet. Use the workspace menu to add one.');
  });

  it('shows recent document titles under a workspace and limits the initial list', () => {
    const workspace = { id: 'ws', name: 'Research', kind: 'PERSONAL', isDefault: false, documentCount: 6, access: 'owner', canCreate: true, canRename: true };
    const sidebarDocuments = Array.from({ length: 6 }, (_, index) => ({ id: `d${index}`, title: `Note ${index}`, workspaceId: 'ws', updatedAt: '2026-10-25T00:00:00.000Z' }));
    stubDocuments([], [workspace], null, sidebarDocuments);
    const html = render();
    expect(html).toContain('Note 0');
    expect(html).toContain('Note 4');
    expect(html).not.toContain('Note 5');
    expect(html).toContain('Show more (1)');
  });

  it('links app admins to team creation without showing that link to regular users', () => {
    stubDocuments([], [], null, [], true);
    expect(render()).toContain('href="/admin"');
    stubDocuments([]);
    expect(render()).not.toContain('href="/admin"');
  });

  it('shows the returned author, workspace, format and View/Edit label for shared and team rows', () => {
    stubDocuments([
      row({ id: 'd1', title: 'My Thesis', slug: 'thesis', isAuthor: true, authorName: 'Ada Lovelace', workspaceName: 'Personal', workspaceId: 'ws-a', access: 'Edit', format: 'MARKDOWN', updatedAt: '2026-10-24T00:00:00.000Z' }),
      row({ id: 'd3', title: 'Thesis', slug: 'thesis', isAuthor: false, authorName: 'Grace Hopper', workspaceName: 'Team Research', workspaceId: 'ws-b', access: 'View', format: 'LATEX', updatedAt: '2026-10-23T00:00:00.000Z' }),
    ]);
    const html = render();

    // The reader's own row stays "You"; the shared row shows the real author and team workspace.
    expect(html).toContain('>You<');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('Team Research');
    expect(html).not.toContain('Ada Lovelace');
    // Format and capability are the returned ones, one per row.
    expect(html).toContain('data-format="MARKDOWN"');
    expect(html).toContain('data-format="LATEX"');
    expect(html).toContain('data-access="Edit"');
    expect(html).toContain('data-access="View"');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>View<');
    expect(html).toContain('>Format<');
    expect(html).toContain('>Access<');
  });

  it('labels an unattributed shared row honestly instead of defaulting it to the reader', () => {
    stubDocuments([row({ id: 'd9', title: 'Orphan', slug: 'orphan', isAuthor: false, workspaceName: 'Shared Vault', access: 'View' })]);
    const html = render();
    expect(html).toContain('Unknown author');
    expect(html).toContain('Shared Vault');
    expect(html).toContain('data-access="View"');
    expect(html).not.toContain('>You<');
  });
});
