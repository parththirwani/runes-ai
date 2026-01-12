import { prisma } from "@/src/lib/db";
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