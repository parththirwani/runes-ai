import { describe, expect, it } from 'vitest';
import {
  decideDocumentAccess,
  decideWorkspaceAccess,
  removedAuthorKeepsAttribution,
  type DocumentFacts,
  type WorkspaceFacts,
} from '@/src/lib/access-policy';

// Five distinct accounts, mirroring the plan's browser and API fixtures:
//   A author of the document, B accepted recipient, C unrelated user,
//   D active team member (ADMIN), E app admin.
const A = 'user-a';
const B = 'user-b';
const C = 'user-c';
const D = 'user-d';
const E = 'user-e';

const view = { permission: 'VIEW' as const, accepted: true, revoked: false };
const pending = { permission: 'VIEW' as const, accepted: false, revoked: false };
const revoked = { permission: 'VIEW' as const, accepted: true, revoked: true };
// Reserved for a later release: nothing in v1 may issue or honour it.
const editGrant = { permission: 'EDIT' as const, accepted: true, revoked: false };

const member = { role: 'MEMBER' as const, active: true };
const teamAdmin = { role: 'ADMIN' as const, active: true };
const removed = { role: 'MEMBER' as const, active: false };

function personalDocFacts(overrides: Partial<DocumentFacts> = {}): DocumentFacts {
  return {
    viewerId: A,
    authorId: A,
    workspaceKind: 'PERSONAL',
    workspaceOwnerUserId: A,
    workspaceTeamId: null,
    isAdmin: false,
    documentGrant: null,
    workspaceGrant: null,
    teamMembership: null,
    authorTeamMembership: null,
    ...overrides,
  };
}

function teamDocFacts(overrides: Partial<DocumentFacts> = {}): DocumentFacts {
  return personalDocFacts({
    workspaceKind: 'TEAM',
    workspaceOwnerUserId: null,
    workspaceTeamId: 'team-1',
    authorId: A,
    ...overrides,
  });
}

describe('document access: personal workspace author', () => {
  it('lets the owner read, edit, share and move their own document', () => {
    expect(decideDocumentAccess(personalDocFacts())).toMatchObject({
      canRead: true,
      canEdit: true,
      canShare: true,
      canMove: true,
      canDelete: true,
      access: 'author',
    });
  });

  it('denies an unrelated user with no grant, without revealing existence', () => {
    expect(decideDocumentAccess(personalDocFacts({ viewerId: C }))).toEqual({
      canRead: false,
      canEdit: false,
      canShare: false,
      canMove: false,
      canDelete: false,
      isAdmin: false,
      authorId: A,
      access: null,
    });
  });
});

describe('document access: direct document share', () => {
  it('grants read to an accepted recipient and nothing else', () => {
    const caps = decideDocumentAccess(personalDocFacts({ viewerId: B, documentGrant: view }));
    expect(caps).toMatchObject({ canRead: true, canEdit: false, canShare: false, canMove: false, canDelete: false, access: 'document-grant' });
  });

  it('grants nothing to a pending or revoked invitation', () => {
    expect(decideDocumentAccess(personalDocFacts({ viewerId: B, documentGrant: pending })).canRead).toBe(false);
    expect(decideDocumentAccess(personalDocFacts({ viewerId: B, documentGrant: revoked })).canRead).toBe(false);
  });

  it('never honours a reserved EDIT grant in v1', () => {
    const caps = decideDocumentAccess(personalDocFacts({ viewerId: B, documentGrant: editGrant }));
    expect(caps.canRead).toBe(false);
    expect(caps.canEdit).toBe(false);
  });

  it('still lets the author edit after the same document is shared', () => {
    expect(decideDocumentAccess(personalDocFacts({ documentGrant: view }))).toMatchObject({ canEdit: true });
  });
});

describe('document access: personal workspace share', () => {
  it('covers current documents for an accepted workspace recipient', () => {
    const caps = decideDocumentAccess(personalDocFacts({ viewerId: B, workspaceGrant: view }));
    expect(caps).toMatchObject({ canRead: true, canEdit: false, access: 'workspace-grant' });
  });

  it('is revoked as soon as the grant is revoked', () => {
    expect(decideDocumentAccess(personalDocFacts({ viewerId: B, workspaceGrant: revoked })).canRead).toBe(false);
  });

  it('does not leak a team workspace share', () => {
    // Workspace grants only apply to personal workspaces; team reads come from membership.
    expect(decideDocumentAccess(teamDocFacts({ viewerId: B, workspaceGrant: view, teamMembership: null })).canRead).toBe(false);
  });
});

describe('document access: team workspace', () => {
  it('lets any active member read documents authored by someone else', () => {
    const caps = decideDocumentAccess(teamDocFacts({ viewerId: D, authorId: A, teamMembership: member, authorTeamMembership: member }));
    expect(caps).toMatchObject({ canRead: true, canEdit: false, canShare: false, access: 'team-member' });
  });

  it('lets an author member edit only their own document', () => {
    expect(decideDocumentAccess(teamDocFacts({ viewerId: A, authorId: A, teamMembership: member, authorTeamMembership: member }))).toMatchObject({ canRead: true, canEdit: true });
    expect(decideDocumentAccess(teamDocFacts({ viewerId: D, authorId: A, teamMembership: teamAdmin, authorTeamMembership: member }))).toMatchObject({ canRead: true, canEdit: false });
  });

  it('blocks a removed member, including a removed author, while keeping attribution', () => {
    const removedMember = decideDocumentAccess(teamDocFacts({ viewerId: D, authorId: A, teamMembership: removed }));
    expect(removedMember.canRead).toBe(false);

    const removedAuthor = decideDocumentAccess(teamDocFacts({ viewerId: A, authorId: A, teamMembership: removed, authorTeamMembership: removed }));
    expect(removedAuthor.canRead).toBe(false);
    expect(removedAuthor.canEdit).toBe(false);
    expect(removedAuthor.authorId).toBe(A);
    expect(removedAuthorKeepsAttribution(teamDocFacts({ viewerId: A, authorId: A, authorTeamMembership: removed }))).toBe(true);
  });

  it('grants nothing to a non-member who only holds a pending team invitation', () => {
    expect(decideDocumentAccess(teamDocFacts({ viewerId: B, teamMembership: null })).canRead).toBe(false);
  });
});

describe('document access: app admin', () => {
  it('reads only through an audited admin inspection, never edits', () => {
    const inspecting = decideDocumentAccess(personalDocFacts({ viewerId: E, isAdmin: true, adminInspection: true }));
    expect(inspecting).toMatchObject({ canRead: true, canEdit: false, canShare: false, canMove: false, access: 'admin-inspection' });

    const ordinaryRequest = decideDocumentAccess(personalDocFacts({ viewerId: E, isAdmin: true }));
    expect(ordinaryRequest.canRead).toBe(false);
  });

  it('does not let an app admin write through a document route in a team workspace', () => {
    expect(decideDocumentAccess(teamDocFacts({ viewerId: E, isAdmin: true, adminInspection: true })).canEdit).toBe(false);
  });
});

describe('workspace capabilities', () => {
  const personal = (overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
    viewerId: A,
    kind: 'PERSONAL',
    ownerUserId: A,
    teamId: null,
    isAdmin: false,
    grant: null,
    teamMembership: null,
    ...overrides,
  });

  const team = (overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
    viewerId: A,
    kind: 'TEAM',
    ownerUserId: null,
    teamId: 'team-1',
    isAdmin: false,
    grant: null,
    teamMembership: member,
    ...overrides,
  });

  it('gives a personal owner read, create, rename and share', () => {
    expect(decideWorkspaceAccess(personal())).toMatchObject({
      canRead: true,
      canCreate: true,
      canRename: true,
      canShare: true,
      canManageTeam: false,
      access: 'author',
    });
  });

  it('gives a share recipient read only', () => {
    expect(decideWorkspaceAccess(personal({ viewerId: B, grant: view }))).toMatchObject({
      canRead: true,
      canCreate: false,
      canRename: false,
      canShare: false,
      access: 'workspace-grant',
    });
  });

  it('gives a pending recipient nothing', () => {
    expect(decideWorkspaceAccess(personal({ viewerId: B, grant: pending }))).toBeNull();
    expect(decideWorkspaceAccess(personal({ viewerId: C }))).toBeNull();
  });

  it('lets every active member create in the team workspace but only admins manage it', () => {
    expect(decideWorkspaceAccess(team({ viewerId: D }))).toMatchObject({ canRead: true, canCreate: true, canShare: false, canManageTeam: false });
    expect(decideWorkspaceAccess(team({ viewerId: D, teamMembership: teamAdmin }))).toMatchObject({ canManageTeam: true, canShare: false });
  });

  it('gives a removed member no workspace at all', () => {
    expect(decideWorkspaceAccess(team({ viewerId: D, teamMembership: removed }))).toBeNull();
  });

  it('gives an app admin read without create', () => {
    expect(decideWorkspaceAccess(personal({ viewerId: E, isAdmin: true }))).toMatchObject({ canRead: true, canCreate: false, access: 'admin-inspection' });
  });
});
