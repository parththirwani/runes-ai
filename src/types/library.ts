// Client-side shapes for the workspace library. They mirror the JSON from
// /api/workspaces, /api/documents and /api/document so a component cannot invent a field the
// server does not send. Capability flags always come from the server; the UI only draws them.

import type { DocumentFormatValue } from './compilation';

export type CapabilitySource =
  | 'author'
  | 'document-grant'
  | 'workspace-grant'
  | 'team-member'
  | 'admin-inspection'
  | null;

export type DocumentCapabilities = {
  canRead: boolean;
  canEdit: boolean;
  canShare: boolean;
  canMove: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  authorId: string;
  access: CapabilitySource;
};

export type WorkspaceCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canRename: boolean;
  canShare: boolean;
  canManageTeam: boolean;
  isAdmin: boolean;
  authorOnlyWrites: boolean;
  access: CapabilitySource;
};

export type LibraryWorkspace = {
  id: string;
  name: string;
  kind: 'PERSONAL' | 'TEAM';
  ownerUserId: string | null;
  teamId: string | null;
  isDefault: boolean;
  teamName: string | null;
  documentCount: number;
  capabilities: WorkspaceCapabilities;
};

export type LibraryAuthor = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type LibraryDocument = {
  id: string;
  title: string;
  slug: string;
  format?: DocumentFormatValue;
  isFavorite: boolean;
  excerpt?: string;
  content?: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string | null;
  workspace?: { id: string; name: string; kind: 'PERSONAL' | 'TEAM' } | null;
  author?: LibraryAuthor | null;
  canEdit?: boolean;
  canShare?: boolean;
  access?: CapabilitySource;
};

/** Which collection the library is showing. Search and filters are always inside it. */
export type LibraryScope =
  | { kind: 'all' }
  | { kind: 'shared' }
  | { kind: 'workspace'; id: string; name: string };

export function scopeKey(scope: LibraryScope): string {
  return scope.kind === 'workspace' ? `workspace:${scope.id}` : scope.kind;
}

export function scopeLabel(scope: LibraryScope): string {
  if (scope.kind === 'all') return 'All documents';
  if (scope.kind === 'shared') return 'Shared with me';
  return scope.name;
}

export type ShareRow = {
  id: string;
  email: string | null;
  recipientName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  permission: 'VIEW';
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
};

export type CreatedInvitation = {
  id: string;
  email: string;
  target: 'TEAM' | 'WORKSPACE' | 'DOCUMENT';
  targetId: string;
  targetName: string;
  role: 'ADMIN' | 'MEMBER';
  status: string;
  expiresAt: string;
  reused: boolean;
  delivery:
    | { channel: 'webhook'; sent: true }
    | { channel: 'webhook-failed' }
    | { channel: 'development-link'; path: string }
    | { channel: 'unavailable' };
};

/** Mirrors MovePreview in src/lib/workspaces.ts: what a move changes about who can see it. */
export type MovePreview = {
  documentId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  grantsTeamAccess: boolean;
  removesTeamAccess: boolean;
  keepsDirectShares: boolean;
  collision: string | null;
};
