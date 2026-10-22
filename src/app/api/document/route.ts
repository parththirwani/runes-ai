import { prisma } from "@/src/lib/db";
import { generateSlug } from "@/src/lib/slug";
import { withAuth } from "@/src/lib/withAuth";
import { createDocumentSchema } from "@/src/schema/documentSchema";
import { latexTemplate, markdownTemplate } from "@/src/lib/templates";
import { plainTextExcerpt } from "@/src/lib/excerpt";
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

    // Use transaction-safe unique constraint instead of manual check
    const slug = generateSlug(title);
    const source = content ?? (format === "MARKDOWN" ? markdownTemplate(title.trim()) : latexTemplate(title.trim()));

    const document = await prisma.document.create({
      data: {
        title: title.trim(),
        content: source,
        format,
        slug,
        userId,
      },
    });

    return NextResponse.json(document, { status: 201 });

  } catch (error: unknown) {
    // Handle unique constraint properly (Prisma error code)
    if (error instanceof Error && 'code' in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "Document with this title already exists" },
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
export const GET = withAuth(async (_req, session) => {
  try {
    const userId = session.user.id;

    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }, // useful UX improvement
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        format: true,
        createdAt: true,
        updatedAt: true,
      }, // avoid sending full content unnecessarily
    });

    // Plain-text excerpts are derived server-side per format so cards never
    // leak raw TeX commands, Markdown syntax, or HTML.
    const documentsWithExcerpt = documents.map((doc) => ({
      ...doc,
      excerpt: plainTextExcerpt(doc.content ?? "", doc.format === "MARKDOWN" ? "MARKDOWN" : "LATEX"),
    }));

    return NextResponse.json(
      { documents: documentsWithExcerpt },
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
