import { NextRequest, NextResponse } from "next/server";
import { chatSchema } from "@/src/schema/chatSchema";
import { prisma } from "@/src/lib/db";
import { ChatCompletion, DiffResponse } from "@/src/lib/openrouter";
import { resolveMainSource } from "@/src/lib/workspace-files";
import { auth } from "@/src/lib/auth";
import type { ZodError } from 'zod';

function formatZodError(error: ZodError) {
  return error.issues.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { message, documentId } = parsed.data;

    // Fetch document WITH ownership check
    const document = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { id: true, title: true, content: true, mainFilePath: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const mainSource = await resolveMainSource(document);

    // AI Call
    const diffResponse: DiffResponse = await ChatCompletion(
      message.trim(),
      mainSource,
      document.title
    );

    return NextResponse.json({ data: diffResponse }, { status: 200 });
  } catch {
    console.error("[CHAT_API_ERROR] Request failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
