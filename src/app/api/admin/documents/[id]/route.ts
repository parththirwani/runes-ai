import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { adminInspectDocument } from '@/src/lib/admin';
import { apiError } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Explicit, audited content inspection for app admins.
 *
 * Reaching this route is the only way an admin sees text they did not author, and every call writes
 * an `document.inspect` audit row naming the actor. It returns a read-only projection: it does not
 * grant editing, sharing or move rights anywhere.
 */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const result = await adminInspectDocument({ actorUserId: session.user.id, documentId: id });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
});
