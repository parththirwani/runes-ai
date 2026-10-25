import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { describeMove, moveDocument } from "@/src/lib/workspaces";
import { moveDocumentSchema } from "@/src/schema/workspaceSchema";

/**
 * Author-only move between workspaces the author may create in.
 *
 * ?preview=1 answers with what the move would change (who gains or loses view access and any
 * title collision) so the UI can show it before confirming. The POST without preview performs
 * the move inside a transaction that re-reads permissions.
 */
export const POST = withAuth(async (req, session, context) =>
  routeResult("DOCUMENT_MOVE_ERROR", async () => {
    const { id } = await context.params;
    const parsed = moveDocumentSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);

    const preview = new URL(req.url).searchParams.get("preview");
    if (preview === "1" || preview === "true") {
      return NextResponse.json({ preview: await describeMove(prisma, session.user.id, String(id), parsed.data.workspaceId) });
    }

    const move = await moveDocument(prisma, session.user.id, String(id), parsed.data.workspaceId);
    return NextResponse.json({ move });
  }),
);
