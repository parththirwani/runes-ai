import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { adminListTeams } from '@/src/lib/admin';
import { apiError } from '@/src/lib/api-errors';

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Paginated team list with member, invitation and document counts. App admins only. */
export const GET = withAuth(async (req, session) => {
  try {
    const params = req.nextUrl.searchParams;
    const result = await adminListTeams({
      actorUserId: session.user.id,
      page: positiveInt(params.get('page'), 1),
      pageSize: positiveInt(params.get('pageSize'), 20),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
});
