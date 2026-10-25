import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { invalidInput, readJson, routeResult } from "@/src/lib/api-result";
import { createDocumentInWorkspace, listDocumentsInWorkspace } from "@/src/lib/workspaces";
import { workspaceDocumentCreateSchema } from "@/src/schema/workspaceSchema";

/* LIST the documents of one workspace, scoped visibly to that workspace. */
export const GET = withAuth(async (req, session, context) =>
  routeResult("WORKSPACE_DOCUMENTS_GET_ERROR", async () => {
    const { id } = await context.params;
    const search = new URL(req.url).searchParams.get("search") ?? undefined;
    return NextResponse.json(await listDocumentsInWorkspace(prisma, session.user.id, String(id), search ?? undefined));
  }),
);

/* CREATE a document in this workspace. Reader-only members are refused by the service. */
export const POST = withAuth(async (req, session, context) =>
  routeResult("WORKSPACE_DOCUMENTS_POST_ERROR", async () => {
    const { id } = await context.params;
    const parsed = workspaceDocumentCreateSchema.safeParse(await readJson(req));
    if (!parsed.success) return invalidInput(parsed.error);
    const document = await createDocumentInWorkspace(prisma, session.user.id, String(id), {
      title: parsed.data.title,
      format: parsed.data.format ?? "LATEX",
      content: parsed.data.content,
    });
    return NextResponse.json({ document }, { status: 201 });
  }),
);
