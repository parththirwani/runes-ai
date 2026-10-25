// The interface draws what the capability service decided, and this checks the drawing.
// Server checks remain the actual control (see the integration suite); these tests fail if a
// affordance the user is not entitled to is rendered at all, or if the read-only state leaves
// a write path on screen.

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import WorkspaceNav from '@/src/app/components/dashboard/workspaceNav';
import TopNavBar from '@/src/app/components/editor/TopNavBar';
import type { LibraryWorkspace, WorkspaceCapabilities } from '@/src/types/library';

function capabilities(overrides: Partial<WorkspaceCapabilities> = {}): WorkspaceCapabilities {
  return {
    canRead: true,
    canCreate: true,
    canRename: false,
    canShare: false,
    canManageTeam: false,
    isAdmin: false,
    authorOnlyWrites: true,
    access: 'author',
    ...overrides,
  };
}

function workspace(overrides: Partial<LibraryWorkspace> = {}): LibraryWorkspace {
  return {
    id: 'ws-1',
    name: 'Lab Notes',
    kind: 'PERSONAL',
    ownerUserId: 'user-1',
    teamId: null,
    isDefault: false,
    teamName: null,
    documentCount: 3,
    capabilities: capabilities(),
    ...overrides,
  };
}

function renderNav(workspaces: LibraryWorkspace[], pendingInvitations = 0) {
  return renderToStaticMarkup(
    React.createElement(WorkspaceNav, {
      scope: { kind: 'all' },
      onScopeChange: () => undefined,
      workspaces,
      pendingInvitations,
      onNewWorkspace: () => undefined,
      onRenameWorkspace: () => undefined,
      onShareWorkspace: () => undefined,
    }),
  );
}

describe('the library scope picker', () => {
  it('offers the two saved scopes and counts what is still waiting', () => {
    const markup = renderNav([workspace()], 2);
    expect(markup).toContain('All documents');
    expect(markup).toContain('Shared with me');
    expect(markup).toContain('2 pending invitations');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Lab Notes');
    expect(markup).toContain('>3<');
  });

  it('says nothing about pending invitations when there are none', () => {
    expect(renderNav([workspace()])).not.toContain('pending invitations');
  });

  it('offers rename and share only for a workspace the caller owns', () => {
    const owned = renderNav([workspace({ capabilities: capabilities({ canRename: true, canShare: true }) })]);
    expect(owned).toContain('Rename Lab Notes');
    expect(owned).toContain('Share Lab Notes');

    const borrowed = renderNav([workspace({ name: 'Shared Desk', capabilities: capabilities({ access: 'workspace-grant' }) })]);
    expect(borrowed).not.toContain('Rename Shared Desk');
    expect(borrowed).not.toContain('Share Shared Desk');
  });

  it('labels a team workspace as read shared for everybody and never offers to share it', () => {
    const markup = renderNav([
      workspace({
        id: 'ws-team',
        name: 'Research',
        kind: 'TEAM',
        ownerUserId: null,
        teamId: 'team-1',
        teamName: 'Research',
        capabilities: capabilities({ canRename: true, canManageTeam: true, access: 'team-member' }),
      }),
    ]);
    expect(markup).toContain('Shared with every Research member, read only');
    expect(markup).not.toContain('Share Research');
  });

  it('tells the user the list is empty instead of showing a blank column', () => {
    expect(renderNav([])).toContain('No workspaces loaded yet.');
  });
});

function renderBar(overrides: Partial<React.ComponentProps<typeof TopNavBar>> = {}) {
  return renderToStaticMarkup(
    React.createElement(TopNavBar, {
      documentTitle: 'Field notes',
      onViewModeChange: () => undefined,
      onMenuToggle: () => undefined,
      onCompile: () => undefined,
      format: 'MARKDOWN',
      ...overrides,
    }),
  );
}

describe('the editor toolbar', () => {
  it('gives the author the write affordances', () => {
    const markup = renderBar();
    expect(markup).toContain('Compile');
    expect(markup).toContain('Click to edit title');
    expect(markup).not.toContain('View only');
  });

  it('renders a reader as a reader: no compile, no title editing, and the author named', () => {
    const markup = renderBar({ readOnly: true, authorName: 'Ada Writer' });
    expect(markup).not.toContain('Compile');
    expect(markup).not.toContain('Click to edit title');
    expect(markup).toContain('View only · Ada Writer');
    expect(markup).toContain('Field notes');
  });

  it('still names the writer when the author row is missing', () => {
    expect(renderBar({ readOnly: true })).toContain('View only');
  });
});
