import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { createDocumentSchema } from "@/src/schema/documentSchema";
import { accessErrorResponse } from "@/src/lib/access";
import { createDocumentInWorkspace, listLibraryDocuments } from "@/src/lib/workspaces";
import { NextResponse } from "next/server";
import type { ZodError } from 'zod';

function formatZodError(error: ZodError) {
  return error.issues.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

/* -------------------- CREATE DOCUMENT -------------------- */
export const POST = withAuth(async (req, session) => {
  try {
    const body = await req.json();

    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: formatZodError(parsed.error),
        },
        { status: 400 }
      );
    }

    const { title, content, workspaceId } = parsed.data;
    // Explicit format is required for new clients; a missing format keeps the
    // documented legacy default of LATEX during the transition.
    const format = parsed.data.format ?? "LATEX";
    const userId = session.user.id;

    // Every document belongs to exactly one collection workspace. A client that names one is
    // checked against the capability service; a client that names none lands in the author's
    // default personal workspace, created on demand for a brand new account.
    const document = await createDocumentInWorkspace(prisma, userId, workspaceId, { title, format, content });

    return NextResponse.json(document, { status: 201 });

  } catch (error: unknown) {
    // A duplicate name inside the workspace, or a workspace the actor may not create in,
    // both arrive as capability errors with the status already decided.
    const denied = accessErrorResponse(error);
    if (denied) return denied;

    // Handle unique constraint properly (Prisma error code)
    if (error instanceof Error && 'code' in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "A document with this name or URL already exists" },
        { status: 409 }
      );
    }

    console.error("[DOCUMENT_POST_ERROR] Request failed");

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

/* -------------------- GET DOCUMENTS -------------------- */
// The library spans every document the actor may read (own work, accepted document grants,
// accepted personal-workspace grants, team membership) and carries the per-document
// capabilities the interface uses to show or hide edit/share/delete affordances.
export const GET = withAuth(async (req, session) => {
  try {
    const userId = session.user.id;
    const params = new URL(req.url).searchParams;
    const scopeParam = params.get("scope");
    const scope = scopeParam === "shared" || scopeParam === "mine" ? scopeParam : "all";

    const { documents } = await listLibraryDocuments(prisma, userId, {
      search: params.get("search") ?? undefined,
      scope,
    });

    return NextResponse.json(
      { documents },
      { status: 200 }
    );

  } catch (error) {
    console.error("[DOCUMENT_GET_ERROR]", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
