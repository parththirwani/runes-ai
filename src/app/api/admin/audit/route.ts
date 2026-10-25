import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { listAuditEvents } from '@/src/lib/audit';
import { requireAppAdmin } from '@/src/lib/admin';
import { apiError } from '@/src/lib/api-errors';

/**
 * Audit trail for team creation, invitations, member removals and document inspections.
 * Rows contain ids and small metadata only, never document content or invitation tokens.
 */
export const GET = withAuth(async (req, session) => {
  try {
    await requireAppAdmin(session.user.id);
    const teamId = req.nextUrl.searchParams.get('teamId');
    const cursor = req.nextUrl.searchParams.get('cursor');
    const events = await listAuditEvents({ teamId: teamId ?? undefined, cursor: cursor ?? undefined });
    return NextResponse.json({ events });
  } catch (error) {
    return apiError(error);
  }
});
