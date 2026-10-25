import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { adminTeamDetail } from '@/src/lib/admin';
import { apiError } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Team detail: members, invitations and a paginated document list with authors. Metadata only. */
export const GET = withAuth(async (req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const params = req.nextUrl.searchParams;
    const detail = await adminTeamDetail({
      actorUserId: session.user.id,
      teamId: id,
      page: positiveInt(params.get('page'), 1),
      pageSize: positiveInt(params.get('pageSize'), 20),
    });
    return NextResponse.json(detail);
  } catch (error) {
    return apiError(error);
  }
});
