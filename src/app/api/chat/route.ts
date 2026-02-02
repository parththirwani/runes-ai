import { z } from "zod";
import { NextRequest } from "next/server";
import { ChatCompletion } from "@/src/lib/openrouter";
import { chatSchema } from "@/src/schema/chatSchema";
import { prisma } from "@/src/lib/db";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsedData = chatSchema.safeParse(body);

    if (!parsedData.success) {
      return new Response(
        JSON.stringify({
          message: "Invalid input",
          errors: parsedData.error,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { message, documentId } = parsedData.data;

    // Fetch the document from database
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true, title: true },
    });

    if (!document) {
      return new Response(
        JSON.stringify({ message: "Document not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const textStream = await ChatCompletion(
            message.trim(),
            document.content,
            document.title
          );

          for await (const chunk of textStream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          details: err.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.error("Chat API error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Something went wrong",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}