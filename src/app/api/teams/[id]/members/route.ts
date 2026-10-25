import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { inviteTeamMember, listTeamInvitations, listTeamMembers, removeTeamMember, resolveTeamActor } from '@/src/lib/teams';
import { apiError, jsonBody, notFound } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/** Roster and open invitations. Team admins and app admins only. */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const actor = await resolveTeamActor(id, session.user.id);
    if (!actor) return notFound('Team not found');
    if (actor.role !== 'ADMIN') return NextResponse.json({ error: 'Team admin access is required' }, { status: 403 });
    return NextResponse.json({ members: await listTeamMembers(id), invitations: await listTeamInvitations(id) });
  } catch (error) {
    return apiError(error);
  }
});

/** Invites a member into the team, which grants access to its default workspace on acceptance. */
export const POST = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const result = await inviteTeamMember({
      actorUserId: session.user.id,
      teamId: id,
      email: typeof body?.email === 'string' ? body.email : '',
    });
    // The response is identical whether or not the address already has an account.
    return NextResponse.json({
      message: 'Invitation sent',
      delivery: result.invitation?.delivery ?? 'manual',
      ...(result.invitation?.inviteUrl ? { inviteUrl: result.invitation.inviteUrl } : {}),
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});

/**
 * Removes a member by membership id. Removal is immediate for every later request, and removing
 * the last admin is rejected rather than leaving the team unmanageable.
 */
export const DELETE = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const membershipId = req.nextUrl.searchParams.get('membershipId') ?? '';
    if (membershipId.length === 0) return NextResponse.json({ error: 'membershipId is required' }, { status: 400 });
    const result = await removeTeamMember({ actorUserId: session.user.id, teamId: id, membershipId });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
});
