import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { createPersonalWorkspace, listAccessibleWorkspaces } from '@/src/lib/workspaces';
import { apiError, jsonBody } from '@/src/lib/api-errors';
import { prisma } from '@/src/lib/db';
import { getAppAdminUser } from '@/src/lib/access';

/** Lists every workspace the signed-in user can open: owned, teamed, or shared in. */
export const GET = withAuth(async (_req, session) => {
  try {
    const workspaces = await listAccessibleWorkspaces(session.user.id);
    // Workspace access covers every document in that collection. Keep the sidebar payload to
    // metadata; the main document API returns source content for editors and previews.
    const documents = await prisma.document.findMany({
      where: { workspaceId: { in: workspaces.map((workspace) => workspace.id) } },
      select: { id: true, title: true, workspaceId: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ workspaces, documents, canCreateTeams: Boolean(await getAppAdminUser(session.user.id)) });
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
