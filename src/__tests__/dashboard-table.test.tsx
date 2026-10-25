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

function stubDocuments(documents: unknown[]) {
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
    workspaces: [],
    selectedWorkspaceId: null,
    selectWorkspace: noop,
    createWorkspace: async () => null,
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
  it('shows the returned author, workspace and View/Edit label for shared and team rows', () => {
    stubDocuments([
      row({ id: 'd1', title: 'My Thesis', slug: 'thesis', isAuthor: true, authorName: 'Ada Lovelace', workspaceName: 'Personal', workspaceId: 'ws-a', access: 'Edit', updatedAt: '2026-10-24T00:00:00.000Z' }),
      row({ id: 'd3', title: 'Thesis', slug: 'thesis', isAuthor: false, authorName: 'Grace Hopper', workspaceName: 'Team Research', workspaceId: 'ws-b', access: 'View', updatedAt: '2026-10-23T00:00:00.000Z' }),
    ]);
    const html = render();

    // The reader's own row stays "You"; the shared row shows the real author and team workspace.
    expect(html).toContain('>You<');
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('Team Research');
    expect(html).not.toContain('Ada Lovelace');
    // Capability labels are the returned ones, one per row.
    expect(html).toContain('data-access="Edit"');
    expect(html).toContain('data-access="View"');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>View<');
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
