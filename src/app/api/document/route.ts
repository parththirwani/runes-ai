import { prisma } from "@/src/lib/db";
import { generateSlug } from "@/src/lib/slug";
import { withAuth } from "@/src/lib/withAuth";
import { documentSchema } from "@/src/schema/documentSchema";
import { NextResponse } from "next/server";

function formatZodError(error: any) {
  return error.issues.map((e: any) => ({
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

  } catch (error: any) {
    // Handle unique constraint properly (Prisma error code)
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Document with this title already exists" },
        { status: 409 }
      );
    }

    console.error("[DOCUMENT_POST_ERROR]", error);

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
        createdAt: true,
        updatedAt: true,
      }, // avoid sending full content unnecessarily
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