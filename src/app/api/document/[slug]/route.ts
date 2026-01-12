import { prisma } from "@/src/lib/db";
import { compileLatexToPDF, validateLatexContent } from "@/src/lib/latex";
import { withAuth } from "@/src/lib/withAuth";
import { documentSchema, updateDocumentSchema } from "@/src/schema/documentSchema";
import { NextResponse } from "next/server";

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
    const updateData: any = {};
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
    const parsedData = documentSchema.safeParse(body);

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

    console.log(`[PDF_COMPILE] Starting compilation for document: ${document.title} (user: ${userId})`);

    // Validate LaTeX content
    const validation = validateLatexContent(document.content);
    if (!validation.isValid) {
      console.warn(`[PDF_COMPILE] Validation failed: ${validation.error}`);
      return NextResponse.json(
        { 
          message: "Invalid LaTeX content",
          error: validation.error
        },
        { status: 400 }
      );
    }

    // Compile LaTeX to PDF
    const result = await compileLatexToPDF(
      document.content,
      document.slug,
      { timeout: 90000 } 
    );

    if (!result.success) {
      console.error(`[PDF_COMPILE] Compilation failed: ${result.error}`);
      return NextResponse.json(
        { 
          message: "LaTeX compilation failed",
          error: result.error,
          duration: result.duration
        },
        { status: 422 }
      );
    }

    console.log(`[PDF_COMPILE] Success! Generated PDF (${result.pdfBuffer!.length} bytes) in ${result.duration}ms`);

    // Log warnings if any
    if (result.warnings) {
      console.warn(`[PDF_COMPILE] Compilation warnings: ${result.warnings}`);
    }

    // Return PDF as response
    return new NextResponse(new Uint8Array(result.pdfBuffer!), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${document.slug}.pdf"`,
        'Content-Length': result.pdfBuffer!.length.toString(),
        'X-Compilation-Duration': result.duration.toString(),
      },
    });

  } catch (error: any) {
    console.error("[PDF_COMPILE_ERROR]", error);
    return NextResponse.json(
      { 
        message: "Failed to compile document",
        error: error.message || "Internal server error"
      },
      { status: 500 }
    );
  }
});