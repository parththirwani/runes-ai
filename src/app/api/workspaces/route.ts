import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { createPersonalWorkspace, listWorkspacesWithCounts } from "@/src/lib/workspaces";
import { createWorkspaceSchema } from "@/src/schema/workspaceSchema";

/* LIST every workspace the signed-in user may open: own personal, shared personal, team. */
export const GET = withAuth(async (_req, session) =>
  routeResult("WORKSPACES_GET_ERROR", async () => NextResponse.json(await listWorkspacesWithCounts(prisma, session.user.id))),
);

/* CREATE an additional personal workspace. Team workspaces come from team creation only. */
export const POST = withAuth(async (req, session) =>
  routeResult("WORKSPACES_POST_ERROR", async () => {
    const parsed = createWorkspaceSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const workspace = await createPersonalWorkspace(prisma, session.user.id, parsed.data.name);
    return NextResponse.json({ workspace }, { status: 201 });
  }),
);
