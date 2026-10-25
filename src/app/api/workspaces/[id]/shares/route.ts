import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { listWorkspaceShares, revokeWorkspaceShare, shareWorkspaceWithEmail } from '@/src/lib/sharing';
import { apiError, jsonBody } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/** Who can already see this workspace, and which invitations are still open. */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    return NextResponse.json({ shares: await listWorkspaceShares(session.user.id, id) });
  } catch (error) {
    return apiError(error);
  }
});

/**
 * Invites someone to view this personal workspace, including documents created later. The
 * response never says whether the address has an account.
 */
export const POST = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const email = typeof body?.email === 'string' ? body.email : '';
    const invitation = await shareWorkspaceWithEmail({ actorUserId: session.user.id, workspaceId: id, email });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});

/** Revokes an accepted grant or cancels a pending invitation. Effective on the next request. */
export const DELETE = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const shareId = req.nextUrl.searchParams.get('shareId') ?? '';
    if (shareId.length === 0) return NextResponse.json({ error: 'shareId is required' }, { status: 400 });
    const result = await revokeWorkspaceShare({ actorUserId: session.user.id, workspaceId: id, shareId });
    return NextResponse.json({ revoked: true, kind: result.kind });
  } catch (error) {
    return apiError(error);
  }
});
