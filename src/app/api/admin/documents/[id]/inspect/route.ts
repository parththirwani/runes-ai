import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { routeResult } from "@/src/lib/api-result";
import { inspectDocument } from "@/src/lib/admin";

/**
 * Explicit content inspection for an app admin. This is the only path that lets an
 * administrator see document source, it is read-only, and it writes an audit event naming the
 * actor, the document, and the file that was read. Editing is never granted this way.
 */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("ADMIN_DOCUMENT_INSPECT_ERROR", async () => {
    const { id } = await context.params;
    return NextResponse.json(await inspectDocument(prisma, session.user.id, String(id)));
  }),
);
