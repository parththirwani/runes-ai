import { NextRequest, NextResponse } from "next/server";
import { chatSchema } from "@/src/schema/chatSchema";
import { prisma } from "@/src/lib/db";
import { ChatCompletion, DiffResponse } from "@/src/lib/openrouter";

function formatZodError(error: any) {
  return error.issues.map((e: any) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: formatZodError(parsed.error),
        },
        { status: 400 }
      );
    }

    const { message, documentId } = parsed.data;

    // Fetch document (minimal fields only)
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true, title: true },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // AI Call
    const diffResponse: DiffResponse = await ChatCompletion(
      message.trim(),
      document.content,
      document.title
    );

    return NextResponse.json(
      { data: diffResponse },
      { status: 200 }
    );

  } catch (error) {
    console.error("[CHAT_API_ERROR]", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}