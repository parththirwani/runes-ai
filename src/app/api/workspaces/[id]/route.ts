import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { getWorkspaceAccess } from "@/src/lib/access";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { renameWorkspace } from "@/src/lib/workspaces";
import { renameWorkspaceSchema } from "@/src/schema/workspaceSchema";

/* METADATA plus the caller's capability flags for one workspace. */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("WORKSPACE_GET_ERROR", async () => {
    const { id } = await context.params;
    const access = await getWorkspaceAccess(prisma, session.user.id, String(id));
    if (!access) return NextResponse.json({ message: "Workspace not found" }, { status: 404 });
    return NextResponse.json(access);
  }),
);

/* RENAME. Personal owner or team admin; the capability service decides. */
export const PATCH = withAuth(async (req, session, context) =>
  routeResult("WORKSPACE_PATCH_ERROR", async () => {
    const { id } = await context.params;
    const parsed = renameWorkspaceSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const workspace = await renameWorkspace(prisma, session.user.id, String(id), parsed.data.name);
    return NextResponse.json({ workspace });
  }),
);
