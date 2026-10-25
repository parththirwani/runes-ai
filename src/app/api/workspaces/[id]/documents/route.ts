import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { getWorkspaceAccess } from '@/src/lib/access';
import { createDocumentInWorkspace, listWorkspaceDocuments } from '@/src/lib/workspaces';
import { documentFormatSchema } from '@/src/schema/documentSchema';
import { WorkspaceInputError } from '@/src/lib/workspaces';
import { apiError, jsonBody, notFound } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Documents in one workspace, each labelled with its author and the caller's access. Readers and
 * creators both get a list; the difference is only in the `access` field and in POST.
 */
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

/** Creates a document in this workspace. Anyone without create rights is refused. */
export const POST = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (title.length === 0) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    // Format comes from the payload but is validated, and the workspace decides nothing about it.
    const parsedFormat = documentFormatSchema.safeParse(body?.format ?? 'LATEX');
    if (!parsedFormat.success) return NextResponse.json({ error: 'Format must be LATEX or MARKDOWN' }, { status: 400 });

    const access = await getWorkspaceAccess(session.user.id, id);
    if (!access) return notFound('Workspace not found');
    if (!access.capabilities.canCreate) {
      return NextResponse.json({ error: 'This workspace is read-only for you' }, { status: 403 });
    }

    const document = await createDocumentInWorkspace({
      userId: session.user.id,
      workspaceId: id,
      title,
      format: parsedFormat.data,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceInputError) return apiError(error);
    return apiError(error);
  }
});
