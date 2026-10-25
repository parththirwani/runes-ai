import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, routeResult } from "@/src/lib/api-result";
import { listAuditEvents } from "@/src/lib/admin";
import { adminListQuerySchema } from "@/src/schema/workspaceSchema";

/**
 * Audit trail for team creation, invitations, member removals, role changes, and admin
 * document inspection. Rows carry ids and small metadata only, never content or tokens.
 */
export const GET = withAuth(async (req, session) =>
  routeResult("ADMIN_AUDIT_GET_ERROR", async () => {
    const params = new URL(req.url).searchParams;
    const parsed = adminListQuerySchema.safeParse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    if (!parsed.success) return invalidInput(parsed.error);
    const teamId = params.get("teamId") ?? undefined;
    return NextResponse.json(await listAuditEvents(prisma, session.user.id, { ...parsed.data, teamId: teamId ?? undefined }));
  }),
);
