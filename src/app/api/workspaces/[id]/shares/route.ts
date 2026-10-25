import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { listWorkspaceShares, revokeShare, shareWorkspace } from "@/src/lib/invitations";
import { shareEmailSchema, shareRevokeSchema } from "@/src/schema/workspaceSchema";

/* LIST pending invitations and accepted or revoked shares for this personal workspace. */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("WORKSPACE_SHARES_GET_ERROR", async () => {
    const { id } = await context.params;
    return NextResponse.json({ shares: await listWorkspaceShares(prisma, session.user.id, String(id)) });
  }),
);

/* INVITE a reader. A workspace share covers its current and future documents. */
export const POST = withAuth(async (req, session, context) =>
  routeResult("WORKSPACE_SHARES_POST_ERROR", async () => {
    const { id } = await context.params;
    const parsed = shareEmailSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const invitation = await shareWorkspace(prisma, session.user.id, String(id), parsed.data.email);
    // The link is only ever returned to the inviter, and only where delivery is local.
    return NextResponse.json({ invitation }, { status: invitation.reused ? 200 : 201 });
  }),
);

/* REVOKE an invitation or an accepted grant. Takes effect on the next request. */
export const DELETE = withAuth(async (req, session, context) =>
  routeResult("WORKSPACE_SHARES_DELETE_ERROR", async () => {
    const { id } = await context.params;
    const parsed = shareRevokeSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    await revokeShare(prisma, session.user.id, { ...parsed.data, workspaceId: String(id) });
    return NextResponse.json({ message: "Share revoked" });
  }),
);
