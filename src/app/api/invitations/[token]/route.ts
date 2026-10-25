import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { prisma } from '@/src/lib/db';
import { acceptInvitation, previewInvitation } from '@/src/lib/invitations';
import { apiError } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ token: string }> };

/**
 * Acceptance endpoints.
 *
 * A token alone proves nothing. Both handlers require a signed-in account and compare that
 * account's stored email with the address the invitation was issued to, so a leaked or copied link
 * opens an explanatory page rather than a document. The preview response never reveals the invited
 * address to the wrong account.
 */
async function viewerEmail(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { token } = await context.params;
    const email = await viewerEmail(session.user.id);
    if (!email) return NextResponse.json({ preview: { state: 'unknown' } }, { status: 404 });
    const preview = await previewInvitation(token, { userId: session.user.id, email });
    return NextResponse.json({ preview });
  } catch (error) {
    return apiError(error);
  }
});

export const POST = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { token } = await context.params;
    const email = await viewerEmail(session.user.id);
    if (!email) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });

    const result = await acceptInvitation(token, { userId: session.user.id, email });
    if (!result.ok) {
      const status = result.preview.state === 'valid' ? 500 : result.preview.state === 'wrong-email' ? 403 : 410;
      return NextResponse.json({ error: 'Could not accept this invitation', preview: result.preview }, { status });
    }
    return NextResponse.json({ accepted: true, preview: result.preview });
  } catch (error) {
    return apiError(error);
  }
});
