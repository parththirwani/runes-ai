
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletion, DiffResponse } from "@/src/lib/openrouter";
import { chatSchema } from "@/src/schema/chatSchema";
import { prisma } from "@/src/lib/db";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedData = chatSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        {
          message: "Invalid input",
          errors: parsedData.error,
        },
        { status: 400 }
      );
    }

    const { message, documentId } = parsedData.data;

    // Fetch the document from database
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true, title: true },
    });

    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    // Get structured diff response
    const diffResponse: DiffResponse = await ChatCompletion(
      message.trim(),
      document.content,
      document.title
    );

    return NextResponse.json(
      {
        data: diffResponse,
        status: 200,
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: err.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    console.error("Chat API error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Something went wrong",
      },
      { status: 500 }
    );
  }
}