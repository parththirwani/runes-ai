// Pure URL and filtering rules for the document library, shared by the dashboard hook, the
// dashboard page and their tests.
//
// The id rule lives here on purpose: slugs are only unique per workspace (the workspaces migration
// re-scoped the unique index to `(workspaceId, slug)`), and a slug is resolved author-scoped, so a
// shared recipient cannot use one at all. Two workspaces holding the same slug meant a slug-keyed
// click, delete or favorite could hit the wrong document. Every new link and mutation therefore
// keys on the immutable document id; slug lookup stays alive server-side only so links written
// before this change keep opening.

export type LibraryDocument = {
  id: string;
  title: string;
  slug: string;
  isFavorite: boolean;
  format?: 'MARKDOWN' | 'LATEX';
  updatedAt: string;
  createdAt?: string;
  workspaceId?: string;
};

export type LibraryFilter = 'ALL' | 'FAVORITES' | 'MARKDOWN' | 'LATEX';

export type LibraryScope = {
  /** Selected workspace, or null for "every workspace the caller can read". */
  workspaceId: string | null;
  search: string;
  filter: LibraryFilter;
  newestFirst: boolean;
};

/** Library list endpoint. The selected workspace id travels to the server so the switcher scopes the list at the source. */
export function documentsListUrl(workspaceId: string | null): string {
  const query = workspaceId ? '?workspaceId=' + encodeURIComponent(workspaceId) : '';
  return '/api/document' + query;
}

/** Mutation and read paths for one row. The id is the only reference that is unambiguous across workspaces. */
export function documentApiUrl(document: { id: string }): string {
  return '/api/document/' + encodeURIComponent(document.id);
}

/** Where a row opens. Recipients only ever resolve ids; authors keep working with them too. */
export function documentOpenPath(document: { id: string }): string {
  return '/document/' + encodeURIComponent(document.id);
}

/**
 * Applies the selected workspace before search and format filters. The server already scopes the
 * response, and this keeps the visible list scoped during the in-flight window after a switch, so
 * rows of the previous workspace never linger under the new selection.
 */
export function selectLibraryDocuments<T extends LibraryDocument>(documents: T[], scope: LibraryScope): T[] {
  const search = scope.search.trim().toLowerCase();
  return documents
    .filter((document) => scope.workspaceId === null || document.workspaceId === scope.workspaceId)
    .filter((document) => document.title.toLowerCase().includes(search))
    .filter((document) => scope.filter === 'ALL' || (scope.filter === 'FAVORITES' ? document.isFavorite : (document.format ?? 'LATEX') === scope.filter))
    .sort((a, b) => (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) * (scope.newestFirst ? 1 : -1));
}
