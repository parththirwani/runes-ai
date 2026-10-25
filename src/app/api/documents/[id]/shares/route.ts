import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { listDocumentShares, revokeDocumentShare, shareDocumentWithEmail } from '@/src/lib/sharing';
import { apiError, jsonBody } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/** Every accepted recipient and open invitation for this document. Author only. */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    return NextResponse.json({ shares: await listDocumentShares(session.user.id, id) });
  } catch (error) {
    return apiError(error);
  }
});

/** Invites one person to view exactly this document. */
export const POST = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const body = await jsonBody(req);
    const email = typeof body?.email === 'string' ? body.email : '';
    const invitation = await shareDocumentWithEmail({ actorUserId: session.user.id, documentId: id, email });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});

/** Revokes one recipient or cancels one pending invitation. */
export const DELETE = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const shareId = req.nextUrl.searchParams.get('shareId') ?? '';
    if (shareId.length === 0) return NextResponse.json({ error: 'shareId is required' }, { status: 400 });
    const result = await revokeDocumentShare({ actorUserId: session.user.id, documentId: id, shareId });
    return NextResponse.json({ revoked: true, kind: result.kind });
  } catch (error) {
    return apiError(error);
  }
});
