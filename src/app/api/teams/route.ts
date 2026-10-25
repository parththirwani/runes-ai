import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { createTeam, listMyTeams } from "@/src/lib/teams";
import { createTeamSchema } from "@/src/schema/workspaceSchema";

/* LIST the teams the signed-in user belongs to, with their role in each. */
export const GET = withAuth(async (_req, session) =>
  routeResult("TEAMS_GET_ERROR", async () => NextResponse.json({ teams: await listMyTeams(prisma, session.user.id) })),
);

/**
 * CREATE a team. App admins only in v1, which is what keeps team creation a controlled
 * operation; the default workspace and the creator's admin membership are created with it.
 */
export const POST = withAuth(async (req, session) =>
  routeResult("TEAMS_POST_ERROR", async () => {
    const parsed = createTeamSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const team = await createTeam(prisma, session.user.id, parsed.data.name);
    return NextResponse.json({ team }, { status: 201 });
  }),
);
