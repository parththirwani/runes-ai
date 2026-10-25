import { describe, expect, it } from 'vitest';
import {
  documentAccessLabel,
  documentApiUrl,
  documentFormatLabel,
  documentOpenPath,
  documentOwnerLabel,
  documentsListUrl,
  documentWorkspaceLabel,
  selectLibraryDocuments,
  type LibraryDocument,
} from '@/src/lib/dashboard-library';

// The migration re-scoped slug uniqueness to the workspace, so the same slug legitimately exists
// twice. These tests pin the rules that keep that legal: requests carry the selected workspace,
// and every link or mutation keys on the id.

function row(overrides: Partial<LibraryDocument> & { id: string; title: string; slug: string }): LibraryDocument {
  return {
    isFavorite: false,
    format: 'MARKDOWN',
    updatedAt: '2026-10-20T00:00:00.000Z',
    workspaceId: 'ws-a',
    ...overrides,
  };
}

// Two populated workspaces holding a same-slug document each — exactly the duplicate the
// migration allows and the pre-fix UI conflated.
const world: LibraryDocument[] = [
  row({ id: 'd1', title: 'Alpha', slug: 'alpha', workspaceId: 'ws-a', updatedAt: '2026-10-24T00:00:00.000Z' }),
  row({ id: 'd2', title: 'Thesis', slug: 'thesis', workspaceId: 'ws-a', updatedAt: '2026-10-22T00:00:00.000Z' }),
  row({ id: 'd3', title: 'Thesis', slug: 'thesis', workspaceId: 'ws-b', updatedAt: '2026-10-23T00:00:00.000Z', format: 'LATEX' }),
  row({ id: 'd4', title: 'Notes', slug: 'notes', workspaceId: 'ws-b', isFavorite: true, updatedAt: '2026-10-21T00:00:00.000Z' }),
];

const all = { workspaceId: null, search: '', filter: 'ALL' as const, newestFirst: true };

describe('library request URLs', () => {
  it('sends the selected workspace to the server and nothing for the all-workspaces view', () => {
    expect(documentsListUrl(null)).toBe('/api/document');
    expect(documentsListUrl('ws-a')).toBe('/api/document?workspaceId=ws-a');
    expect(documentsListUrl('ws b/c')).toBe('/api/document?workspaceId=ws%20b%2Fc');
  });

  it('keys open, delete, and favorite paths on the id, never the slug', () => {
    expect(documentOpenPath(world[1])).toBe('/document/d2');
    expect(documentOpenPath(world[2])).toBe('/document/d3');
    // The two same-slug twins must produce different targets.
    expect(documentOpenPath(world[1])).not.toBe(documentOpenPath(world[2]));
    expect(documentApiUrl(world[1])).toBe('/api/document/d2');
    expect(documentApiUrl(world[2])).toBe('/api/document/d3');
  });
});

describe('library scoping between two populated workspaces', () => {
  it('shows every readable row when no workspace is selected', () => {
    expect(selectLibraryDocuments(world, all).map((doc) => doc.id)).toEqual(['d1', 'd3', 'd2', 'd4']);
  });

  it('shows only the selected workspace rows, and switching shows the other ones', () => {
    const first = selectLibraryDocuments(world, { ...all, workspaceId: 'ws-a' });
    expect(first.map((doc) => doc.id)).toEqual(['d1', 'd2']);
    const second = selectLibraryDocuments(world, { ...all, workspaceId: 'ws-b' });
    expect(second.map((doc) => doc.id)).toEqual(['d3', 'd4']);
    const back = selectLibraryDocuments(world, { ...all, workspaceId: 'ws-a' });
    expect(back.map((doc) => doc.id)).toEqual(['d1', 'd2']);
  });

  it('applies favorites and format filters inside the selected workspace', () => {
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-a', filter: 'FAVORITES' })).toEqual([]);
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-b', filter: 'FAVORITES' }).map((doc) => doc.id)).toEqual(['d4']);
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-a', filter: 'LATEX' })).toEqual([]);
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-b', filter: 'LATEX' }).map((doc) => doc.id)).toEqual(['d3']);
  });

  it('searches titles and sorts in both directions within the scope', () => {
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-b', search: ' thesis ' }).map((doc) => doc.id)).toEqual(['d3']);
    expect(selectLibraryDocuments(world, { ...all, workspaceId: 'ws-a', newestFirst: false }).map((doc) => doc.id)).toEqual(['d2', 'd1']);
  });
});

// The library must attribute a shared or team document to whoever the server returned, not to the
// reader. "You" is only honest for the caller's own rows; every other row shows the returned author,
// workspace and the caller's View/Edit capability (access plan UI rule: show author, workspace,
// format and the user's View or Edit capability).
describe('library row labels', () => {
  it('labels the caller\u2019s own rows "You" and everyone else by the returned author', () => {
    expect(documentOwnerLabel({ isAuthor: true, authorName: 'Ada Lovelace' })).toBe('You');
    expect(documentOwnerLabel({ isAuthor: false, authorName: 'Ada Lovelace' })).toBe('Ada Lovelace');
    expect(documentOwnerLabel({ isAuthor: false, authorName: '   Ada Lovelace  ' })).toBe('Ada Lovelace');
    expect(documentOwnerLabel({ isAuthor: false, authorName: '   ' })).toBe('Unknown author');
    expect(documentOwnerLabel({ isAuthor: false })).toBe('Unknown author');
  });

  it('shows the returned View/Edit capability, defaulting a legacy row to view-only', () => {
    expect(documentAccessLabel({ isAuthor: true, access: 'Edit' })).toBe('Edit');
    expect(documentAccessLabel({ isAuthor: false, access: 'View' })).toBe('View');
    expect(documentAccessLabel({ isAuthor: true })).toBe('Edit');
    expect(documentAccessLabel({ isAuthor: false })).toBe('View');
    expect(documentAccessLabel({})).toBe('View');
  });

  it('shows the returned workspace, or a neutral dash for a legacy row without one', () => {
    expect(documentWorkspaceLabel({ workspaceName: 'Team Research' })).toBe('Team Research');
    expect(documentWorkspaceLabel({ workspaceName: '  Personal  ' })).toBe('Personal');
    expect(documentWorkspaceLabel({ workspaceName: '' })).toBe('—');
    expect(documentWorkspaceLabel({})).toBe('—');
  });

  it('shows the row format, treating a legacy row with no format as LaTeX like the server does', () => {
    expect(documentFormatLabel({ format: 'MARKDOWN' })).toBe('Markdown');
    expect(documentFormatLabel({ format: 'LATEX' })).toBe('LaTeX');
    expect(documentFormatLabel({})).toBe('LaTeX');
  });
});
