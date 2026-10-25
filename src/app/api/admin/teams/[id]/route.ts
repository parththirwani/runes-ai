import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { routeResult } from "@/src/lib/api-result";
import { getTeamDetail } from "@/src/lib/admin";

/**
 * Team detail for the admin dashboard: members with roles, invitations, the default
 * workspace, and that workspace's documents with their authors. App admins only; a non-admin
 * receives the same response an absent team would.
 */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("ADMIN_TEAM_GET_ERROR", async () => {
    const { id } = await context.params;
    return NextResponse.json(await getTeamDetail(prisma, session.user.id, String(id)));
  }),
);
