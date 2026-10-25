import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { createTeam, listTeamsForUser } from '@/src/lib/teams';
import { getAppAdminUser } from '@/src/lib/access';
import { apiError, jsonBody } from '@/src/lib/api-errors';

/** Teams the signed-in user belongs to. Everyone may list; that reveals nothing private. */
export const GET = withAuth(async (_req, session) => {
  try {
    return NextResponse.json({ teams: await listTeamsForUser(session.user.id) });
  } catch (error) {
    return apiError(error);
  }
});

/**
 * Creates a team with its first admin membership and its default workspace, in one transaction.
 * Creation is restricted to app admins; team admins manage members, they do not found teams.
 */
export const POST = withAuth(async (req, session) => {
  try {
    const appAdmin = await getAppAdminUser(session.user.id);
    if (!appAdmin) {
      return NextResponse.json({ error: 'Only an app admin can create teams' }, { status: 403 });
    }
    const body = await jsonBody(req);
    const team = await createTeam({ name: typeof body?.name === 'string' ? body.name : '', createdById: appAdmin.id });
    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});
