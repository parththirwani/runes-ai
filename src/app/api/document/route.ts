import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { documentSchema } from "@/src/schema/documentSchema";
import { NextResponse } from "next/server";

export const POST = withAuth(async (req, session) => {
  try {
    const userId = session.user.id;
    const body = await req.json();

    const parsedData = documentSchema.safeParse(body);
    if (!parsedData.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsedData.error },
        { status: 400 }
      );
    }

    const { title, content } = parsedData.data;

    const existingDocument = await prisma.document.findUnique({
      where: { title },
    });

    if (existingDocument) {
      return NextResponse.json(
        { message: "The document with this title already exists" },
        { status: 400 }
      );
    }

    const document = await prisma.document.create({
      data: {
        title,
        content,
        userId,
      },
    });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error("[DOCUMENT_POST_ERROR]", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});


export const GET = withAuth(async (_req, session) => {
  try {
    const userId = session.user.id;

    const documents = await prisma.document.findMany({
      where: { userId },
    });

    return NextResponse.json({
      message: "Documents retrieved",
      documents,
    });
  } catch (error) {
    console.error("[DOCUMENT_GET_ERROR]", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});
