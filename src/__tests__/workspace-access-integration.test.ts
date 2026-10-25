// End-to-end permission checks against a real PostgreSQL database.
//
// These run the actual services (src/lib/workspaces.ts, teams.ts, invitations.ts, sharing.ts)
// against the real schema, so constraints a fake cannot prove are covered here: workspace-scoped
// uniqueness, the partial unique indexes behind team creation, invitation token hashing, and the
// fact that revocation is re-derived on the next request.
//
// The suite needs a reachable database and skips itself otherwise:
//   DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<disposable-db> bun run test:integration

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/src/lib/db';
import { getDocumentAccess, getAppAdminUser } from '@/src/lib/access';
import {
  createDocumentInWorkspace,
  ensureDefaultPersonalWorkspace,
  listAccessibleWorkspaces,
  moveDocument,
  WorkspaceInputError,
} from '@/src/lib/workspaces';
import { createInvitation, acceptInvitation, previewInvitation, revokeInvitation } from '@/src/lib/invitations';
import { createTeam, inviteTeamMember, listTeamMembers, removeTeamMember, TeamError } from '@/src/lib/teams';
import { shareDocumentWithEmail, revokeDocumentShare, listDocumentShares, SharingError } from '@/src/lib/sharing';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const run = 'wsit' + Date.now().toString(36);
const emailFor = (role: string) => `${run}-${role}@example.test`;

type Actor = { userId: string; email: string; workspaceId: string };
const actors = {} as Record<'author' | 'recipient' | 'teammate' | 'outsider' | 'admin', Actor>;
const createdUserIds: string[] = [];

async function makeUser(role: string, isAdmin = false): Promise<Actor> {
  const email = emailFor(role);
  const user = await prisma.user.create({ data: { email, firstName: role, isAdmin } });
  createdUserIds.push(user.id);
  const workspace = await ensureDefaultPersonalWorkspace(user.id);
  return { userId: user.id, email, workspaceId: workspace.id };
}

async function makeDocument(actor: Actor, title: string) {
  return createDocumentInWorkspace({ userId: actor.userId, workspaceId: actor.workspaceId, title, format: 'LATEX' });
}

function inviteUrlToken(invitation: { inviteUrl?: string }) {
  if (!invitation.inviteUrl) throw new Error('expected a dev invite link to be returned once');
  return new URL(invitation.inviteUrl).pathname.split('/').pop() as string;
}

suite('workspace access against a real database', () => {
  beforeAll(async () => {
    actors.author = await makeUser('author');
    actors.recipient = await makeUser('recipient');
    actors.teammate = await makeUser('teammate');
    actors.outsider = await makeUser('outsider');
    actors.admin = await makeUser('admin', true);
  });

  afterAll(async () => {
    const teamIds = (await prisma.team.findMany({ where: { createdById: { in: createdUserIds } }, select: { id: true } })).map((t) => t.id);
    await prisma.documentGrant.deleteMany({ where: { recipientUserId: { in: createdUserIds } } });
    await prisma.workspaceGrant.deleteMany({ where: { recipientUserId: { in: createdUserIds } } });
    await prisma.invitation.deleteMany({ where: { OR: [{ inviterUserId: { in: createdUserIds } }, { targetEmail: { contains: run } }] } });
    await prisma.adminAuditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: createdUserIds } }, { teamId: { in: teamIds } }] } });
    await prisma.teamMember.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.document.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.workspace.deleteMany({ where: { OR: [{ ownerUserId: { in: createdUserIds } }, { teamId: { in: teamIds } }] } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it('gives each user exactly one default personal workspace and reuses it', async () => {
    const again = await ensureDefaultPersonalWorkspace(actors.author.userId);
    expect(again.id).toBe(actors.author.workspaceId);
    const defaults = await prisma.workspace.count({ where: { ownerUserId: actors.author.userId, kind: 'PERSONAL', isDefault: true } });
    expect(defaults).toBe(1);
  });

  it('scopes title and slug uniqueness to the workspace instead of the author', async () => {
    const second = await prisma.workspace.create({ data: { name: 'Second', kind: 'PERSONAL', ownerUserId: actors.author.userId } });
    await makeDocument(actors.author, 'Collisions');
    await expect(makeDocument(actors.author, 'Collisions')).rejects.toBeInstanceOf(WorkspaceInputError);

    // The same title in another of the author's own workspaces is a different scope, so it is legal.
    const elsewhere = await createDocumentInWorkspace({ userId: actors.author.userId, workspaceId: second.id, title: 'Collisions', format: 'LATEX' });
    expect(elsewhere.workspaceId).toBe(second.id);
    expect(elsewhere.slug).toBe('collisions');

    const visible = await listAccessibleWorkspaces(actors.author.userId);
    expect(visible.map((w) => w.id)).toEqual(expect.arrayContaining([actors.author.workspaceId, second.id]));
  });

  it('grants a document invitation only to the invited account, and only for that document', async () => {
    const document = await makeDocument(actors.author, 'Shared doc');
    const other = await makeDocument(actors.author, 'Private doc');
    const invitation = await shareDocumentWithEmail({ actorUserId: actors.author.userId, documentId: document.id, email: actors.recipient.email });
    const token = inviteUrlToken(invitation);

    // No token row ever stores the token itself.
    const stored = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(stored?.tokenHash).not.toContain(token);

    expect(await previewInvitation(token, { userId: actors.outsider.userId, email: actors.outsider.email })).toMatchObject({ state: 'wrong-email' });

    // A wrong-account acceptance attempt grants nothing.
    const refused = await acceptInvitation(token, { userId: actors.outsider.userId, email: actors.outsider.email });
    expect(refused.ok).toBe(false);
    expect(await getDocumentAccess(actors.outsider.userId, document.id)).toBeNull();

    const accepted = await acceptInvitation(token, { userId: actors.recipient.userId, email: actors.recipient.email });
    expect(accepted.ok).toBe(true);

    const access = await getDocumentAccess(actors.recipient.userId, document.id);
    expect(access?.capabilities).toMatchObject({ canRead: true, canEdit: false, canShare: false, source: 'document-grant' });
    // Exactly the invited document, not the rest of the author's library.
    expect(await getDocumentAccess(actors.recipient.userId, other.id)).toBeNull();

    // Accepting twice is not a second grant and never errors.
    await expect(acceptInvitation(token, { userId: actors.recipient.userId, email: actors.recipient.email })).resolves.toMatchObject({ ok: true });
    expect(await prisma.documentGrant.count({ where: { documentId: document.id, recipientUserId: actors.recipient.userId } })).toBe(1);

    // A late cancellation of the invitation cannot rewrite its accepted state. The grant is
    // revoked separately, through the share endpoint below.
    await revokeInvitation(invitation.id, actors.author.userId);
    expect((await prisma.invitation.findUnique({ where: { id: invitation.id } }))?.status).toBe('ACCEPTED');
    expect(await getDocumentAccess(actors.recipient.userId, document.id)).not.toBeNull();

    const [share] = await listDocumentShares(actors.author.userId, document.id);
    await revokeDocumentShare({ actorUserId: actors.author.userId, documentId: document.id, shareId: share.id });
    expect(await getDocumentAccess(actors.recipient.userId, document.id)).toBeNull();

    // A recipient may not re-share, and a non-author may not move or delete.
    await expect(shareDocumentWithEmail({ actorUserId: actors.recipient.userId, documentId: document.id, email: actors.teammate.email })).rejects.toBeInstanceOf(SharingError);
    await expect(moveDocument({ userId: actors.recipient.userId, documentId: document.id, toWorkspaceId: actors.teammate.workspaceId })).rejects.toBeInstanceOf(WorkspaceInputError);
  });

  it('honours expired and revoked invitation tokens', async () => {
    const document = await makeDocument(actors.author, 'Expiring doc');
    const invitation = await shareDocumentWithEmail({ actorUserId: actors.author.userId, documentId: document.id, email: actors.recipient.email });
    const token = inviteUrlToken(invitation);
    await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await previewInvitation(token, { userId: actors.recipient.userId, email: actors.recipient.email })).toMatchObject({ state: 'expired' });
    await expect(acceptInvitation(token, { userId: actors.recipient.userId, email: actors.recipient.email })).resolves.toMatchObject({ ok: false });

    const second = await shareDocumentWithEmail({ actorUserId: actors.author.userId, documentId: document.id, email: actors.teammate.email });
    const secondToken = inviteUrlToken(second);
    await revokeInvitation(second.id, actors.author.userId);
    expect(await previewInvitation(secondToken, { userId: actors.teammate.userId, email: actors.teammate.email })).toMatchObject({ state: 'revoked' });
    expect(await previewInvitation('00'.repeat(32), { userId: actors.recipient.userId, email: actors.recipient.email })).toMatchObject({ state: 'unknown' });
  });

  it('creates a team with one admin and one default workspace, and shares it with members', async () => {
    const team = await createTeam({ name: 'Research ' + run, createdById: actors.author.userId });
    const workspace = await prisma.workspace.findFirst({ where: { teamId: team.id } });
    expect(workspace?.kind).toBe('TEAM');
    expect(workspace?.isDefault).toBe(true);
    expect(await prisma.workspace.count({ where: { teamId: team.id, kind: 'TEAM', isDefault: true } })).toBe(1);
    expect(await prisma.teamMember.count({ where: { teamId: team.id, active: true, role: 'ADMIN' } })).toBe(1);

    const invited = await inviteTeamMember({ actorUserId: actors.author.userId, teamId: team.id, email: actors.teammate.email });
    expect(invited.alreadyMember).toBe(false);
    await acceptInvitation(inviteUrlToken(invited.invitation!), { userId: actors.teammate.userId, email: actors.teammate.email });
    // Inviting somebody who is already a member answers the same way as for an unknown address.
    expect((await inviteTeamMember({ actorUserId: actors.author.userId, teamId: team.id, email: actors.teammate.email })).alreadyMember).toBe(true);

    const teamDoc = await createDocumentInWorkspace({ userId: actors.author.userId, workspaceId: workspace!.id, title: 'Team paper', format: 'LATEX' });
    const memberAccess = await getDocumentAccess(actors.teammate.userId, teamDoc.id);
    expect(memberAccess?.capabilities).toMatchObject({ canRead: true, canEdit: false, canCreate: true, source: 'team-member' });
    expect(memberAccess?.author?.id).toBe(actors.author.userId);
    expect(await getDocumentAccess(actors.outsider.userId, teamDoc.id)).toBeNull();

    // The author still edits their own document inside the team workspace.
    expect((await getDocumentAccess(actors.author.userId, teamDoc.id))?.capabilities.canEdit).toBe(true);

    // A member who authored a document keeps attribution after removal, and loses access.
    const memberDoc = await createDocumentInWorkspace({ userId: actors.teammate.userId, workspaceId: workspace!.id, title: 'Member notes', format: 'LATEX' });
    const members = await listTeamMembers(team.id);
    const membership = members.find((m) => m.userId === actors.teammate.userId)!;
    await expect(removeTeamMember({ actorUserId: actors.author.userId, teamId: team.id, membershipId: membership.membershipId })).resolves.toMatchObject({ removed: true, retainedAuthoredDocuments: 1 });
    expect(await getDocumentAccess(actors.teammate.userId, teamDoc.id)).toBeNull();
    const orphaned = await prisma.document.findUnique({ where: { id: memberDoc.id } });
    expect(orphaned?.userId).toBe(actors.teammate.userId);
    await expect(moveDocument({ userId: actors.teammate.userId, documentId: memberDoc.id, toWorkspaceId: actors.teammate.workspaceId }))
      .rejects.toMatchObject({ status: 403 });
    expect((await prisma.document.findUnique({ where: { id: memberDoc.id } }))?.workspaceId).toBe(workspace!.id);

    // The last admin cannot be removed, and a member cannot remove anybody.
    const adminMembership = (await listTeamMembers(team.id)).find((m) => m.userId === actors.author.userId)!;
    await expect(removeTeamMember({ actorUserId: actors.author.userId, teamId: team.id, membershipId: adminMembership.membershipId })).rejects.toThrow(/at least one admin/);
    await expect(removeTeamMember({ actorUserId: actors.teammate.userId, teamId: team.id, membershipId: adminMembership.membershipId })).rejects.toBeInstanceOf(TeamError);

    const audit = await prisma.adminAuditEvent.findMany({ where: { teamId: team.id }, orderBy: { createdAt: 'desc' } });
    expect(audit.some((event) => event.action === 'team.member.remove' && event.actorUserId === actors.author.userId)).toBe(true);
  });

  it('moves documents between the author workspaces and refuses collisions', async () => {
    const document = await makeDocument(actors.author, 'Movable');
    const target = await prisma.workspace.create({ data: { name: 'Move target ' + run, kind: 'PERSONAL', ownerUserId: actors.author.userId } });
    await expect(moveDocument({ userId: actors.author.userId, documentId: document.id, toWorkspaceId: target.id })).resolves.toMatchObject({ unchanged: false });
    expect((await prisma.document.findUnique({ where: { id: document.id } }))?.workspaceId).toBe(target.id);
    // Moving to the same workspace is a no-op rather than an error.
    await expect(moveDocument({ userId: actors.author.userId, documentId: document.id, toWorkspaceId: target.id })).resolves.toMatchObject({ unchanged: true });

    // The destination may not already own the title or the slug.
    const clash = await createDocumentInWorkspace({ userId: actors.author.userId, workspaceId: actors.author.workspaceId, title: 'Movable', format: 'LATEX' });
    const error = await moveDocument({ userId: actors.author.userId, documentId: clash.id, toWorkspaceId: target.id }).catch((e) => e);
    expect(error).toBeInstanceOf(WorkspaceInputError);
    expect((error as WorkspaceInputError).status).toBe(409);
    expect(await prisma.document.count({ where: { workspaceId: target.id, title: 'Movable' } })).toBe(1);

    // Nobody else can move it, not even a recipient of a direct share.
    await expect(moveDocument({ userId: actors.outsider.userId, documentId: document.id, toWorkspaceId: actors.outsider.workspaceId })).rejects.toBeInstanceOf(WorkspaceInputError);
  });

  it('keeps the app-admin flag as the only route into admin access', async () => {
    expect(await getAppAdminUser(actors.outsider.userId)).toBeNull();
    expect(await getAppAdminUser(actors.admin.userId)).toMatchObject({ id: actors.admin.userId, isAdmin: true });
  });
});
