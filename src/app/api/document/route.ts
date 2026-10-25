import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { createDocumentSchema } from "@/src/schema/documentSchema";
import { plainTextExcerpt } from "@/src/lib/excerpt";
import { listAccessibleWorkspaces, createDocumentInWorkspace, ensureDefaultPersonalWorkspace, WorkspaceInputError } from "@/src/lib/workspaces";
import { NextResponse } from "next/server";
import type { ZodError } from 'zod';

type DashboardListRow = {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  format: 'MARKDOWN' | 'LATEX';
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: 'PERSONAL' | 'TEAM';
  authorName: string;
  isAuthor: boolean;
  access: 'Edit' | 'View';
  excerpt: string;
};

function formatZodError(error: ZodError) {
  return error.issues.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

function inputError(error: unknown) {
  if (error instanceof WorkspaceInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

/* -------------------- CREATE DOCUMENT -------------------- */
export const POST = withAuth(async (req, session) => {
  try {
    const body = await req.json();

    const parsed = createDocumentSchema.safeParse(body);
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
    // Explicit format is required for new clients; a missing format keeps the
    // documented legacy default of LATEX during the transition.
    const format = parsed.data.format ?? "LATEX";
    const userId = session.user.id;

    // A new document lands in a workspace the caller may author in. Without an explicit
    // workspace the author's default personal workspace is used, which is what every
    // pre-workspaces client expects.
    const workspaceId = parsed.data.workspaceId ?? (await ensureDefaultPersonalWorkspace(userId)).id;
    const document = await createDocumentInWorkspace({ userId, workspaceId, title, format, content });

    return NextResponse.json(document, { status: 201 });

  } catch (error: unknown) {
    const handled = inputError(error);
    if (handled) return handled;

    // Handle unique constraint properly (Prisma error code)
    if (error instanceof Error && 'code' in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "A document with this name or URL already exists" },
        { status: 409 }
      );
    }

    console.error("[DOCUMENT_POST_ERROR] Request failed");

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

/* -------------------- GET DOCUMENTS -------------------- */
/**
 * Lists what the caller can read, labelled with the author and the caller's own access level.
 * Passing ?workspaceId= narrows the result to one scope; without it every readable scope is
 * returned so the library can group it, and search and filters still apply per selected scope.
 */
export const GET = withAuth(async (req, session) => {
  try {
    const userId = session.user.id;
    const workspaceFilter = req.nextUrl.searchParams.get('workspaceId');

    const workspaces = await listAccessibleWorkspaces(userId);
    if (workspaceFilter && !workspaces.some((workspace) => workspace.id === workspaceFilter)) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const scope = workspaceFilter ? workspaces.filter((workspace) => workspace.id === workspaceFilter) : workspaces;

    const rows: DashboardListRow[][] = await Promise.all(scope.map(async (workspace) => {
      const documents = await prisma.document.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          format: true,
          isFavorite: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const authors = await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(documents.map((document) => document.userId))) } },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      const nameById = new Map(authors.map((author) => [
        author.id,
        `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim() || author.email,
      ]));
      return documents.map((document) => ({
        ...document,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceKind: workspace.kind,
        authorName: nameById.get(document.userId) ?? 'Unknown author',
        isAuthor: document.userId === userId,
        access: document.userId === userId && workspace.canCreate ? 'Edit' : 'View',
        excerpt: plainTextExcerpt(document.content ?? "", document.format === "MARKDOWN" ? "MARKDOWN" : "LATEX"),
      }));
    }));

    // A direct document share grants no workspace scope, so those rows never come back through the
    // workspace loop above. They are added here, and only when no single workspace is selected:
    // filtering by workspace means "show me that scope", which a recipient of one document cannot
    // browse anyway.
    const direct = workspaceFilter ? [] : (await prisma.documentGrant.findMany({
      where: { recipientUserId: userId, permission: "VIEW", acceptedAt: { not: null }, revokedAt: null },
      include: {
        document: {
          include: {
            workspace: { select: { id: true, name: true, kind: true } },
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { acceptedAt: "asc" },
    })).map((grant) => {
      const document = grant.document;
      const author = document.user;
      const authorName = author
        ? [author.firstName, author.lastName].filter(Boolean).join(" ").trim() || author.email
        : "Unknown author";
      return {
        id: document.id,
        title: document.title,
        slug: document.slug,
        content: document.content,
        format: document.format as DashboardListRow['format'],
        isFavorite: document.isFavorite,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        workspaceId: document.workspace.id,
        workspaceName: document.workspace.name,
        workspaceKind: document.workspace.kind,
        authorName,
        isAuthor: false,
        access: "View" as const,
        excerpt: plainTextExcerpt(document.content ?? "", document.format === "MARKDOWN" ? "MARKDOWN" : "LATEX"),
      };
    });

    const seen = new Set<string>();
    const documents = [...rows.flat(), ...direct]
      .filter((document) => (seen.has(document.id) ? false : (seen.add(document.id), true)))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json(
      { documents, workspaces },
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
