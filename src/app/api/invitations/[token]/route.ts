import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { routeResult } from "@/src/lib/api-result";
import { normalizeEmail } from "@/src/lib/email";
import { acceptInvitation, previewInvitation } from "@/src/lib/invitations";

/**
 * Preview an invitation link. The signed-in address decides whether the target is shown:
 * a link sent to somebody else confirms only that it belongs to another address, and an
 * unknown token looks exactly like an expired or revoked one.
 */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("INVITATION_GET_ERROR", async () => {
    const { token } = await context.params;
    const preview = await previewInvitation(prisma, String(token), normalizeEmail(session.user.email));
    return NextResponse.json({ preview });
  }),
);

/**
 * Accept an invitation. Acceptance is idempotent and turns the promise into a real grant or
 * membership; nothing before this call gives any access.
 */
export const POST = withAuth(async (_req, session, context) =>
  routeResult("INVITATION_POST_ERROR", async () => {
    const { token } = await context.params;
    const result = await acceptInvitation(prisma, String(token), session.user.id, normalizeEmail(session.user.email));
    return NextResponse.json({ invitation: result });
  }),
);
