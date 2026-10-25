import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { listDocumentShares, revokeShare, shareDocument } from "@/src/lib/invitations";
import { shareEmailSchema, shareRevokeSchema } from "@/src/schema/workspaceSchema";

/* LIST who can read this document, by address until they accept. */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("DOCUMENT_SHARES_GET_ERROR", async () => {
    const { id } = await context.params;
    return NextResponse.json({ shares: await listDocumentShares(prisma, session.user.id, String(id)) });
  }),
);

/* INVITE a reader for this single document. Author only. */
export const POST = withAuth(async (req, session, context) =>
  routeResult("DOCUMENT_SHARES_POST_ERROR", async () => {
    const { id } = await context.params;
    const parsed = shareEmailSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const invitation = await shareDocument(prisma, session.user.id, String(id), parsed.data.email);
    return NextResponse.json({ invitation }, { status: invitation.reused ? 200 : 201 });
  }),
);

/* REVOKE a document reader. The next request from that reader fails. */
export const DELETE = withAuth(async (req, session, context) =>
  routeResult("DOCUMENT_SHARES_DELETE_ERROR", async () => {
    const { id } = await context.params;
    const parsed = shareRevokeSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    await revokeShare(prisma, session.user.id, { ...parsed.data, documentId: String(id) });
    return NextResponse.json({ message: "Share revoked" });
  }),
);
