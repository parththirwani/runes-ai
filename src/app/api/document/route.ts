import { prisma } from "@/src/lib/db";
import { generateSlug } from "@/src/lib/slug";
import { summarizeLatex } from "@/src/lib/latex-summary";
import { withAuth } from "@/src/lib/withAuth";
import { documentSchema } from "@/src/schema/documentSchema";
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

    const parsed = documentSchema.safeParse(body);
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
    const userId = session.user.id;

    // Use transaction-safe unique constraint instead of manual check
    const slug = generateSlug(title);

    const document = await prisma.document.create({
      data: {
        title: title.trim(),
        content,
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
      // Newest work first, matching the "updated" label shown on each card.
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // The list view never needs the full LaTeX source, only a safe excerpt.
    return NextResponse.json(
      {
        documents: documents.map((document) => ({
          id: document.id,
          title: document.title,
          slug: document.slug,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          summary: summarizeLatex(document.content),
        })),
      },
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
