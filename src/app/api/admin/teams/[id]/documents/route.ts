import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, routeResult } from "@/src/lib/api-result";
import { listTeamDocuments } from "@/src/lib/admin";
import { adminListQuerySchema } from "@/src/schema/workspaceSchema";

/**
 * Paginated document metadata for one team's default workspace: title, format, author, and
 * timestamps. Reading the actual source needs the explicit audited inspection route, and both
 * record an audit event.
 */
export const GET = withAuth(async (req, session, context) =>
  routeResult("ADMIN_TEAM_DOCUMENTS_GET_ERROR", async () => {
    const { id } = await context.params;
    const params = new URL(req.url).searchParams;
    const parsed = adminListQuerySchema.safeParse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    if (!parsed.success) return invalidInput(parsed.error);
    return NextResponse.json(await listTeamDocuments(prisma, session.user.id, String(id), parsed.data));
  }),
);
