import { describe, expect, it } from 'vitest';
import {
  getDocumentAccess,
  getWorkspaceAccess,
  readableDocument,
  writableDocument,
  listReadableDocumentsInWorkspace,
  getAppAdminUser,
} from '@/src/lib/access';
import { actors, dates, makeAccessClient, makeWorld } from './helpers/access-fake';

const personal = { id: 'ws-a-personal', name: 'Personal', kind: 'PERSONAL' as const, ownerUserId: actors.authorA, teamId: null, isDefault: true };
const team = { id: 'ws-team-default', name: 'Research', kind: 'TEAM' as const, ownerUserId: null, teamId: 'team-1', isDefault: true };

describe('permission matrix — personal workspace owner', () => {
  it('reads, creates, edits and shares their own document', async () => {
    const resolved = await getDocumentAccess(actors.authorA, 'doc-a', makeAccessClient(makeWorld()));
    expect(resolved).not.toBeNull();
    expect(resolved!.capabilities).toMatchObject({ canRead: true, canCreate: true, canEdit: true, canShare: true, source: 'author' });
  });

  it('owns the workspace with rename and share rights', async () => {
    const access = await getWorkspaceAccess(actors.authorA, 'ws-a-personal', makeAccessClient(makeWorld()));
    expect(access?.capabilities).toMatchObject({ canRead: true, canCreate: true, canShare: true, canRename: true, canManageTeam: false });
  });
});

describe('permission matrix — unrelated user', () => {
  it('gets no access to a private document or its workspace', async () => {
    const client = makeAccessClient(makeWorld());
    expect(await getDocumentAccess(actors.unrelatedC, 'doc-a', client)).toBeNull();
    expect(await getWorkspaceAccess(actors.unrelatedC, 'ws-a-personal', client)).toBeNull();
    expect(await readableDocument(actors.unrelatedC, 'doc-a', client)).toBeNull();
    expect(await writableDocument(actors.unrelatedC, 'doc-a', client)).toBeNull();
  });

  it('gets no access to an unknown document id', async () => {
    expect(await getDocumentAccess(actors.authorA, 'does-not-exist', makeAccessClient(makeWorld()))).toBeNull();
  });
});

describe('permission matrix — accepted document recipient', () => {
  it('reads only the shared document and cannot write or share', async () => {
    const client = makeAccessClient(makeWorld({ documentGrant: {} }));
    const access = await getDocumentAccess(actors.viewerB, 'doc-a', client);
    expect(access?.capabilities).toEqual({ canRead: true, canCreate: false, canEdit: false, canShare: false, canManageTeam: false, source: 'document-grant' });
    expect(access?.author).toMatchObject({ id: actors.authorA, name: 'Author A' });

    // A direct grant exposes exactly one document: the team document and the author's
    // other work stay invisible.
    expect(await getDocumentAccess(actors.viewerB, 'doc-team', client)).toBeNull();
    expect(await listReadableDocumentsInWorkspace(actors.viewerB, personal, client)).toEqual([]);
  });

  it('cannot write through the write-intent lookup', async () => {
    const client = makeAccessClient(makeWorld({ documentGrant: {} }));
    expect(await readableDocument(actors.viewerB, 'doc-a', client)).not.toBeNull();
    expect(await writableDocument(actors.viewerB, 'doc-a', client)).toBeNull();
  });
});

describe('permission matrix — accepted personal workspace recipient', () => {
  it('reads every document in the shared workspace, current and future', async () => {
    const world = makeWorld({ workspaceGrant: {} });
    world.documents.push({
      id: 'doc-a-2', title: 'Later draft', slug: 'later-draft', format: 'MARKDOWN', mainFilePath: 'main.md',
      content: 'written after the share', userId: actors.authorA, workspaceId: 'ws-a-personal',
      createdAt: dates.future, updatedAt: dates.future,
    });
    const client = makeAccessClient(world);

    const listed = await listReadableDocumentsInWorkspace(actors.viewerB, personal, client);
    expect(listed.map((row) => row.document.id).sort()).toEqual(['doc-a', 'doc-a-2']);
    expect(listed.every((row) => row.canEdit === false)).toBe(true);
    expect(listed.every((row) => row.authorName === 'Author A')).toBe(true);

    const later = await getDocumentAccess(actors.viewerB, 'doc-a-2', client);
    expect(later?.capabilities).toMatchObject({ canRead: true, canEdit: false, canShare: false, source: 'workspace-grant' });
  });

  it('does not leak documents from the owner’s other workspaces or from teams', async () => {
    const client = makeAccessClient(makeWorld({ workspaceGrant: {} }));
    expect(await getDocumentAccess(actors.viewerB, 'doc-team', client)).toBeNull();
  });
});

describe('permission matrix — pending, expired, revoked or wrong-email invitations', () => {
  it('grants nothing before acceptance', async () => {
    const client = makeAccessClient(makeWorld({ documentGrant: { acceptedAt: null } }));
    expect(await getDocumentAccess(actors.viewerB, 'doc-a', client)).toBeNull();
  });

  it('grants nothing after revocation', async () => {
    const client = makeAccessClient(makeWorld({ documentGrant: { revokedAt: dates.future } }));
    expect(await getDocumentAccess(actors.viewerB, 'doc-a', client)).toBeNull();
    const workspaceClient = makeAccessClient(makeWorld({ workspaceGrant: { revokedAt: dates.future } }));
    expect(await getDocumentAccess(actors.viewerB, 'doc-a', workspaceClient)).toBeNull();
    expect(await listReadableDocumentsInWorkspace(actors.viewerB, personal, workspaceClient)).toEqual([]);
  });

  it('never honours a grant issued with the reserved EDIT permission', async () => {
    const client = makeAccessClient(makeWorld({ documentGrant: { permission: 'EDIT' } }));
    expect(await getDocumentAccess(actors.viewerB, 'doc-a', client)).toBeNull();
  });
});

describe('permission matrix — team workspace', () => {
  it('lets every active member read all documents with the right author', async () => {
    const client = makeAccessClient(makeWorld());
    const listed = await listReadableDocumentsInWorkspace(actors.authorA, team, client);
    expect(listed.map((row) => [row.document.id, row.authorName, row.canEdit])).toEqual([
      ['doc-team', 'Author A', true],
      ['doc-team-d', 'Team Admin', false],
    ]);
  });

  it('lets the team admin read another member’s document but never edit it', async () => {
    const client = makeAccessClient(makeWorld());
    const access = await getDocumentAccess(actors.teamAdminD, 'doc-team', client);
    expect(access?.capabilities).toMatchObject({ canRead: true, canCreate: true, canEdit: false, canManageTeam: true, source: 'team-member' });
    expect(await writableDocument(actors.teamAdminD, 'doc-team', client)).toBeNull();
    // The admin still edits their own document.
    expect((await getDocumentAccess(actors.teamAdminD, 'doc-team-d', client))?.capabilities.canEdit).toBe(true);
  });

  it('lets a member create documents there and edit only their own', async () => {
    const client = makeAccessClient(makeWorld());
    const member = await getWorkspaceAccess(actors.authorA, 'ws-team-default', client);
    expect(member?.capabilities).toMatchObject({ canRead: true, canCreate: true, canEdit: false, canManageTeam: false });
  });

  it('cuts a removed member off on the next request while keeping attribution', async () => {
    const client = makeAccessClient(makeWorld());
    expect(await getDocumentAccess(actors.removedMemberF, 'doc-team', client)).toBeNull();
    expect(await listReadableDocumentsInWorkspace(actors.removedMemberF, team, client)).toEqual([]);
    const listed = await listReadableDocumentsInWorkspace(actors.teamAdminD, team, client);
    expect(listed.find((row) => row.document.id === 'doc-team')?.authorName).toBe('Author A');
  });

  it('cuts the author off their own team document once the author is removed', async () => {
    const client = makeAccessClient(makeWorld({ authorRemovedFromTeam: true }));
    const access = await getDocumentAccess(actors.authorA, 'doc-team', client);
    expect(access).toBeNull();
    // Attribution survives: the team admin still sees A as the author.
    const listed = await listReadableDocumentsInWorkspace(actors.teamAdminD, team, client);
    expect(listed.find((row) => row.document.id === 'doc-team')?.authorName).toBe('Author A');
  });
});

describe('permission matrix — app admin', () => {
  it('is recognised by the admin lookup only through the stored flag', async () => {
    const client = makeAccessClient(makeWorld());
    expect(await getAppAdminUser(actors.appAdminE, client)).toMatchObject({ id: actors.appAdminE, isAdmin: true });
    expect(await getAppAdminUser(actors.teamAdminD, client)).toBeNull();
    expect(await getAppAdminUser(actors.authorA, client)).toBeNull();
  });

  it('does not gain document access outside admin endpoints', async () => {
    const client = makeAccessClient(makeWorld());
    expect(await getDocumentAccess(actors.appAdminE, 'doc-a', client)).toBeNull();
    expect(await getDocumentAccess(actors.appAdminE, 'doc-team', client)).toBeNull();
  });

  it('does not gain editing anywhere, not even inside a team it belongs to', async () => {
    const world = makeWorld();
    world.memberships.push({ teamId: 'team-1', userId: actors.appAdminE, role: 'MEMBER', active: true });
    const client = makeAccessClient(world);
    const access = await getDocumentAccess(actors.appAdminE, 'doc-team', client);
    expect(access?.capabilities).toMatchObject({ canRead: true, canEdit: false, canManageTeam: false });
  });
});
