import { prisma } from "@/src/lib/db";
import { generateSlug } from "@/src/lib/slug";
import { withAuth } from "@/src/lib/withAuth";
import { createDocumentSchema } from "@/src/schema/documentSchema";
import { latexTemplate, markdownTemplate } from "@/src/lib/templates";
import { listLibraryDocuments } from "@/src/lib/workspaces";
import { ensureDefaultPersonalWorkspace } from "@/src/lib/workspace-ownership";
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

    const { title, content } = parsed.data;
    // Explicit format is required for new clients; a missing format keeps the
    // documented legacy default of LATEX during the transition.
    const format = parsed.data.format ?? "LATEX";
    const userId = session.user.id;

    // Every document belongs to exactly one collection workspace. Legacy clients that do
    // not name one land in the author's default personal workspace, which is created on
    // demand so a brand new account can create its first document.
    const { workspaceId } = await ensureDefaultPersonalWorkspace(prisma, userId);

    // Use transaction-safe unique constraint instead of manual check
    const slug = generateSlug(title);
    const source = content ?? (format === "MARKDOWN" ? markdownTemplate(title.trim()) : latexTemplate(title.trim()));

    const document = await prisma.document.create({
      data: {
        title: title.trim(),
        content: source,
        format,
        mainFilePath: format === "MARKDOWN" ? "main.md" : "main.tex",
        slug,
        userId,
        workspaceId,
      },
    });

    return NextResponse.json(document, { status: 201 });

  } catch (error: unknown) {
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
    const search = new URL(req.url).searchParams.get("search") ?? undefined;

    const { documents } = await listLibraryDocuments(prisma, userId, search);

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
