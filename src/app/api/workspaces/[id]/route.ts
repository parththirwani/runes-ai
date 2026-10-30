import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { getWorkspaceAccess } from '@/src/lib/access';
import { deletePersonalWorkspace, listWorkspaceDocuments, renameWorkspace } from '@/src/lib/workspaces';
import { apiError, jsonBody, notFound } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/** Metadata plus the caller's capabilities for one workspace. */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const listed = await listWorkspaceDocuments(session.user.id, id);
    if (!listed) return notFound('Workspace not found');
    return NextResponse.json(listed);
  } catch (error) {
    return apiError(error);
  }
});

/** Renames a personal workspace, or a team workspace when the caller is a team admin. */
export const PATCH = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const access = await getWorkspaceAccess(session.user.id, id);
    if (!access) return notFound('Workspace not found');
    if (!access.capabilities.canRename) {
      return NextResponse.json({ error: 'You do not have permission to rename this workspace' }, { status: 403 });
    }
    const workspace = await renameWorkspace(session.user.id, id, typeof body?.name === 'string' ? body.name : '');
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiError(error);
  }
});

/** Removes an empty non-default personal workspace owned by the caller. */
export const DELETE = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    if (!await deletePersonalWorkspace(session.user.id, id)) return notFound('Workspace not found');
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
});
