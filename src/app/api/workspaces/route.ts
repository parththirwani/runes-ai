import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { createPersonalWorkspace, listAccessibleWorkspaces } from '@/src/lib/workspaces';
import { apiError, jsonBody } from '@/src/lib/api-errors';

/** Lists every workspace the signed-in user can open: owned, teamed, or shared in. */
export const GET = withAuth(async (_req, session) => {
  try {
    return NextResponse.json({ workspaces: await listAccessibleWorkspaces(session.user.id) });
  } catch (error) {
    return apiError(error);
  }
});

/** Creates an additional personal workspace. Team workspaces are created with the team. */
export const POST = withAuth(async (req, session) => {
  try {
    const body = await jsonBody(req);
    const name = typeof body?.name === 'string' ? body.name : '';
    const workspace = await createPersonalWorkspace(session.user.id, name);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});
