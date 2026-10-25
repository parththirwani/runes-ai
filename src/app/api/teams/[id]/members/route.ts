import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { changeTeamMemberRole, listTeamMembers, removeTeamMember } from "@/src/lib/teams";
import { inviteTeamMember } from "@/src/lib/invitations";
import { changeTeamRoleSchema, inviteTeamMemberSchema, removeTeamMemberSchema } from "@/src/schema/workspaceSchema";

/* LIST members and roles. Team admin for their team, app admin for any team. */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("TEAM_MEMBERS_GET_ERROR", async () => {
    const { id } = await context.params;
    return NextResponse.json({ members: await listTeamMembers(prisma, session.user.id, String(id)) });
  }),
);

/* INVITE a member. Delivery depends on the configured provider; see src/lib/invite-delivery.ts. */
export const POST = withAuth(async (req, session, context) =>
  routeResult("TEAM_MEMBERS_POST_ERROR", async () => {
    const { id } = await context.params;
    const parsed = inviteTeamMemberSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const invitation = await inviteTeamMember(prisma, session.user.id, String(id), parsed.data.email, parsed.data.role);
    return NextResponse.json({ invitation }, { status: invitation.reused ? 200 : 201 });
  }),
);

/**
 * REMOVE a member by membership id. The last active admin of a team cannot be removed, and
 * the removal names the acting user in the audit trail.
 */
export const DELETE = withAuth(async (req, session, context) =>
  routeResult("TEAM_MEMBERS_DELETE_ERROR", async () => {
    const { id } = await context.params;
    const parsed = removeTeamMemberSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const result = await removeTeamMember(prisma, session.user.id, String(id), parsed.data.memberId);
    return NextResponse.json({ removed: result });
  }),
);

/* CHANGE a member role, still protecting the last admin. */
export const PATCH = withAuth(async (req, session, context) =>
  routeResult("TEAM_MEMBERS_PATCH_ERROR", async () => {
    const { id } = await context.params;
    const parsed = changeTeamRoleSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    await changeTeamMemberRole(prisma, session.user.id, String(id), parsed.data.memberId, parsed.data.role);
    return NextResponse.json({ message: "Role updated" });
  }),
);
