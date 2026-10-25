import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { routeResult } from "@/src/lib/api-result";
import { getDocumentAccess } from "@/src/lib/access";

/**
 * Resolves a stable document id for the current user.
 *
 * New links use /document/id/[id]. This endpoint answers the canonical author-scoped slug so
 * the client can land on the one editor implementation, and returns the caller's capability
 * flags. An id the user cannot read is a 404, identical to an id that does not exist.
 */
export const GET = withAuth(async (_req, session, context) =>
  routeResult("DOCUMENT_BY_ID_GET_ERROR", async () => {
    const { id } = await context.params;
    const access = await getDocumentAccess(prisma, session.user.id, String(id));
    if (!access) return NextResponse.json({ message: "Document not found" }, { status: 404 });

    return NextResponse.json({
      document: {
        id: access.document.id,
        title: access.document.title,
        slug: access.document.slug,
        format: access.document.format,
        workspaceId: access.document.workspaceId,
        authorId: access.document.userId,
      },
      capabilities: access.capabilities,
      canonicalPath: "/document/" + encodeURIComponent(access.document.slug),
    });
  }),
);
