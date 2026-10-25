import { NextRequest, NextResponse } from "next/server";
import { chatSchema } from "@/src/schema/chatSchema";
import { prisma } from "@/src/lib/db";
import { ChatCompletion, DiffResponse } from "@/src/lib/openrouter";
import { resolveMainSource } from "@/src/lib/workspace-files";
import { withAuth } from "@/src/lib/withAuth";
import { findAuthorOnlyDocument } from "@/src/lib/access";
import type { ZodError } from 'zod';

function formatZodError(error: ZodError) {
  return error.issues.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

export const POST = withAuth(async (req: NextRequest, session) => {
  try {
    const userId = session.user.id!;

    const body = await req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { message, documentId } = parsed.data;

    // Author-only in v1, like the other AI routes.
    const document = await findAuthorOnlyDocument(prisma, userId, documentId, {
      id: true,
      title: true,
      content: true,
      mainFilePath: true,
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "AI provider not configured" }, { status: 503 });
    }

    const mainSource = await resolveMainSource(document);

    // AI Call
    const diffResponse: DiffResponse = await ChatCompletion(
      message.trim(),
      mainSource,
      document.title
    );

    return NextResponse.json({ data: diffResponse }, { status: 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("[CHAT_API_ERROR] Request failed");
    return NextResponse.json(
      { error: "AI service unavailable" },
      { status: 502 }
    );
  }
});
