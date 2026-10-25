import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { listTeams } from "@/src/lib/admin";
import { createTeam } from "@/src/lib/teams";
import { adminListQuerySchema, createTeamSchema } from "@/src/schema/workspaceSchema";

function query(req: Request) {
  const params = new URL(req.url).searchParams;
  return adminListQuerySchema.safeParse({ page: params.get("page") ?? undefined, pageSize: params.get("pageSize") ?? undefined });
}

/* LIST every team with member, invitation, workspace, and document counts. App admins only. */
export const GET = withAuth(async (req, session) =>
  routeResult("ADMIN_TEAMS_GET_ERROR", async () => {
    const parsed = query(req);
    if (!parsed.success) return invalidInput(parsed.error);
    return NextResponse.json(await listTeams(prisma, session.user.id, parsed.data));
  }),
);

/* CREATE a team with its default workspace and the creator as its first admin. */
export const POST = withAuth(async (req, session) =>
  routeResult("ADMIN_TEAMS_POST_ERROR", async () => {
    const parsed = createTeamSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const team = await createTeam(prisma, session.user.id, parsed.data.name);
    return NextResponse.json({ team }, { status: 201 });
  }),
);
