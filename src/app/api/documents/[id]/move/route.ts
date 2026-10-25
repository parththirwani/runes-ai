import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { describeMoveImpact, moveDocument } from '@/src/lib/workspaces';
import { openWritableDocument } from '@/src/lib/document-lookup';
import { apiError, jsonBody, notFound } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Author-only move. The route first reports what the move would change so the UI can confirm it,
 * then re-checks both workspaces inside the write transaction.
 */
export const POST = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const toWorkspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if (toWorkspaceId.length === 0) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });

    const access = await openWritableDocument(session.user.id, id);
    if (!access) return notFound('Document not found');

    if (body?.confirm !== true) {
      const impact = await describeMoveImpact(access.document.id, toWorkspaceId);
      return NextResponse.json({ confirm: true, impact });
    }

    const result = await moveDocument({ userId: session.user.id, documentId: access.document.id, toWorkspaceId });
    return NextResponse.json({
      document: { id: result.document.id, title: result.document.title, workspaceId: result.document.workspaceId, slug: result.document.slug },
      unchanged: result.unchanged,
    });
  } catch (error) {
    return apiError(error);
  }
});
