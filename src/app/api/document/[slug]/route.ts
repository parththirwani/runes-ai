import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { updateDocumentSchema } from "@/src/schema/documentSchema";
import { compilationProducer } from "@/producer/queue";
import { checkRateLimit } from "@/src/lib/rateLimit";
import { NextResponse } from "next/server";
import type { SnapshotAsset } from "@/src/types/compilation";

export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    
    const document = await prisma.document.findFirst({
      where: {
        slug: slug,
        userId: userId
      }
    });
  
    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }
  
    return NextResponse.json(
      {
        message: "Document retrieved successfully",
        document: document
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[DOCUMENT_GET_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;

    const document = await prisma.document.findFirst({
      where: {
        slug: slug,
        userId: userId
      }
    });
  
    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    await prisma.document.delete({
      where: {
        id: document.id
      }
    });
  
    return NextResponse.json(
      { message: "Document deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[DOCUMENT_DELETE_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

export const PUT = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    const body = await req.json(); 
    const parsedData = updateDocumentSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { message: "Invalid input"},
        { status: 400 }
      );
    }

    const document = await prisma.document.findFirst({
      where: {
        slug: slug,
        userId: userId
      }
    });
  
    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    const { title, content } = parsedData.data;

    // Single update with only provided fields
    const updateData: { title?: string; content?: string } = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;

    const updatedDocument = await prisma.document.update({
      where: {
        id: document.id
      },
      data: updateData
    });

    return NextResponse.json(
      {
        message: "Document updated successfully",
        document: updatedDocument
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[DOCUMENT_PUT_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

export const PATCH = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    const body = await req.json(); 
    const parsedData = updateDocumentSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { message: "Invalid input"},
        { status: 400 }
      );
    }

    const document = await prisma.document.findFirst({
      where: {
        slug: slug,
        userId: userId
      }
    });
  
    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    const { title, content } = parsedData.data;
    
    const updatedDocument = await prisma.document.update({
      where: {
        id: document.id
      },
      data: {
        title: title,
        content: content
      }
    });
  
    return NextResponse.json(
      {
        message: "Document updated successfully",
        document: updatedDocument
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[DOCUMENT_PATCH_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

// POST endpoint with rate limiting - queues a compilation job
export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    
    // Find the document
    const document = await prisma.document.findFirst({
      where: {
        slug: slug,
        userId: userId
      }
    });
  
    if (!document) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    const rateLimitResult = await checkRateLimit(document.id);

    if (!rateLimitResult.allowed) {
      console.log(`[PDF_COMPILE] Rate limit exceeded for document ${document.id} (user: ${userId})`);
      
      return NextResponse.json(
        { 
          message: rateLimitResult.error,
          remaining: rateLimitResult.remaining,
          resetAt: rateLimitResult.resetAt
        },
        { 
          status: 429, 
          headers: {
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString()
          }
        }
      );
    }

    console.log(`[PDF_COMPILE] Queueing compilation for document: ${document.title} (user: ${userId}, remaining: ${rateLimitResult.remaining})`);

    // Format is derived server-side from the owned document row; the client
    // never chooses the compiler. Markdown jobs embed their local assets in
    // the immutable snapshot so the worker compiles exactly what was saved.
    const format = document.format === 'MARKDOWN' ? 'MARKDOWN' : 'LATEX';
    let assets: SnapshotAsset[] | undefined;
    if (format === 'MARKDOWN') {
      const rows = await prisma.documentAsset.findMany({
        where: { documentId: document.id },
        select: { path: true, mediaType: true, bytes: true },
        orderBy: { path: 'asc' },
      });
      assets = rows.map((row) => ({
        path: row.path,
        mediaType: row.mediaType,
        data: Buffer.from(row.bytes).toString('base64'),
      }));
    }

    // Add job to queue
    const jobId = await compilationProducer.addJob({
      documentId: document.id,
      userId: userId,
      slug: document.slug,
      content: document.content,
      format,
      assets,
    });

    console.log(`[PDF_COMPILE] Job ${jobId} queued successfully`);

    return NextResponse.json(
      { 
        message: "Compilation job queued",
        jobId: jobId,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          resetAt: rateLimitResult.resetAt
        }
      },
      { 
        status: 202, 
        headers: {
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString()
        }
      }
    );

  } catch {
    console.error("[PDF_COMPILE_ERROR] Request failed");
    return NextResponse.json(
      { 
        message: "Failed to queue compilation",
        error: "Internal server error"
      },
      { status: 500 }
    );
  }
});
