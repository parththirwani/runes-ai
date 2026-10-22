import { prisma } from '@/src/lib/db';
import { withAuth } from '@/src/lib/withAuth';
import { documentSchema, updateDocumentSchema, workspaceSaveSchema } from '@/src/schema/documentSchema';
import { compilationProducer } from '@/producer/queue';
import { checkRateLimit } from '@/src/lib/rateLimit';
import { NextResponse } from 'next/server';
import {
  WorkspaceError,
  WorkspacePathError,
  ensureDocumentMigrated,
  readWorkspaceTree,
  writeTextFile,
} from '@/src/lib/workspace-files';
import { createCompileSnapshot } from '@/src/lib/workspace-snapshot';
import { compilerOptionsForCacheKey, configuredEngine, engineVersion } from '@/worker/latex-compiler';

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  throw error;
}

/* ------------------------- GET workspace with file metadata ------------------------- */
export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const workspace = await readWorkspaceTree(session.user.id, slug);
    if (!workspace) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    const main = workspace.files.find((file) => file.path === workspace.document.mainFilePath);
    const mainRecord = await prisma.workspaceFile.findUnique({
      where: { documentId_path: { documentId: workspace.document.id, path: workspace.document.mainFilePath } },
      select: { content: true },
    });

    return NextResponse.json(
      {
        message: 'Document retrieved successfully',
        document: {
          id: workspace.document.id,
          title: workspace.document.title,
          slug: workspace.document.slug,
          format: workspace.document.format,
          updatedAt: workspace.document.updatedAt,
          mainFilePath: workspace.document.mainFilePath,
          // Legacy shape: single source clients keep reading Document.content.
          content: mainRecord?.content ?? '',
          mainFile: main ? { path: main.path, revision: main.revision, checksum: main.checksum } : null,
          files: workspace.files,
          tree: workspace.tree,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
});

export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;

    const document = await prisma.document.findFirst({ where: { slug, userId } });
    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    // Workspace files cascade with the document; stored asset bytes are content addressed
    // and are reclaimed by the storage prune job.
    await prisma.document.delete({ where: { id: document.id } });

    return NextResponse.json({ message: 'Document deleted successfully' }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
});

/* --------------------------- PUT save (legacy + files) --------------------------- */
export const PUT = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    const body = await req.json();

    const document = await prisma.document.findFirst({ where: { slug, userId } });
    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }
    const workspaceAvailable = Boolean((prisma as unknown as { workspaceFile?: unknown }).workspaceFile);
    if (!workspaceAvailable) {
      const legacy = updateDocumentSchema.safeParse(body);
      if (!legacy.success) return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      const updated = await prisma.document.update({ where: { id: document.id }, data: legacy.data });
      return NextResponse.json({ message: 'Document updated successfully', document: updated }, { status: 200 });
    }
    await ensureDocumentMigrated(prisma, document.id);

    const updates: { title?: string } = {};
    const parsedTitle = updateDocumentSchema.safeParse(body);
    if (!parsedTitle.success) {
      return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
    }
    if (parsedTitle.data.title !== undefined) updates.title = parsedTitle.data.title;

    // Multi file saves go through the workspace path; the legacy {content} shape keeps
    // working by writing the currently selected main file.
    const filesPayload = workspaceSaveSchema.safeParse(body);
    const results: { path: string; revision: number; checksum: string }[] = [];
    if (filesPayload.success && filesPayload.data.files) {
      for (const file of filesPayload.data.files) {
        const written = await writeTextFile({
          userId,
          slug,
          rawPath: file.path,
          content: file.content,
          baseRevision: file.baseRevision ?? null,
        });
        if (written && 'conflict' in written) {
          return NextResponse.json(
            { message: 'Another save changed ' + file.path, file: written.conflict },
            { status: 409 },
          );
        }
        if (written) results.push({ path: written.file.path, revision: written.file.revision, checksum: written.file.checksum });
      }
    } else if (parsedTitle.data.content !== undefined) {
      const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
      if (!currentDocument) return NextResponse.json({ message: 'Document not found' }, { status: 404 });
      const written = await writeTextFile({ userId, slug, rawPath: currentDocument.mainFilePath, content: parsedTitle.data.content });
      if (written && 'conflict' in written) {
        return NextResponse.json({ message: 'Another save changed the main file', file: written.conflict }, { status: 409 });
      }
      if (written) results.push({ path: written.file.path, revision: written.file.revision, checksum: written.file.checksum });
    }

    if (updates.title !== undefined) {
      await prisma.document.update({ where: { id: document.id }, data: { title: updates.title } });
    }

    const updated = await prisma.document.findUnique({ where: { id: document.id } });
    return NextResponse.json(
      {
        message: 'Document updated successfully',
        document: { ...updated, content: results[0] ? undefined : updated?.content },
        saved: results,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
});

export const PATCH = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;
    const body = await req.json();
    const parsedData = documentSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
    }

    const document = await prisma.document.findFirst({ where: { slug, userId } });
    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }
    const workspaceAvailable = Boolean((prisma as unknown as { workspaceFile?: unknown }).workspaceFile);
    if (!workspaceAvailable) {
      const { title, content } = parsedData.data;
      const updated = await prisma.document.update({ where: { id: document.id }, data: { title, content: content ?? document.content ?? '' } });
      return NextResponse.json({ message: 'Document updated successfully', document: updated }, { status: 200 });
    }
    await ensureDocumentMigrated(prisma, document.id);

    const { title, content } = parsedData.data;
    const nextContent = content ?? document.content ?? '';
    await writeTextFile({ userId, slug, rawPath: document.mainFilePath, content: nextContent });
    const updated = await prisma.document.update({ where: { id: document.id }, data: { title, content: nextContent } });

    return NextResponse.json({ message: 'Document updated successfully', document: updated }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
});

/* ------------------------------ POST compile ------------------------------ */
export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const userId = session.user.id;

    const document = await prisma.document.findFirst({ where: { slug, userId } });
    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }
    const rateLimitResult = await checkRateLimit(document.id);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { message: rateLimitResult.error, remaining: rateLimitResult.remaining, resetAt: rateLimitResult.resetAt },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
          },
        },
      );
    }

    const workspaceAvailable = Boolean((prisma as unknown as { workspaceFile?: unknown }).workspaceFile);
    if (!workspaceAvailable) {
      let assets: Array<{ path: string; mediaType: string; data: string }> | undefined;
      const legacyDocumentAsset = (prisma as unknown as { documentAsset?: typeof prisma.documentAsset }).documentAsset;
      if (document.format === 'MARKDOWN' && legacyDocumentAsset) {
        const rows = await legacyDocumentAsset.findMany({
          where: { documentId: document.id }, select: { path: true, mediaType: true, bytes: true }, orderBy: { path: 'asc' },
        });
        assets = rows.map((row: { path: string; mediaType: string; bytes: Uint8Array }) => ({ path: row.path, mediaType: row.mediaType, data: Buffer.from(row.bytes).toString('base64') }));
      }
      const jobId = await compilationProducer.addJob({
        documentId: document.id,
        userId,
        slug: document.slug,
        content: document.content ?? '',
        format: document.format === 'MARKDOWN' ? 'MARKDOWN' : 'LATEX',
        assets,
      });
      return NextResponse.json({ message: 'Compilation job queued', jobId, rateLimit: { remaining: rateLimitResult.remaining, resetAt: rateLimitResult.resetAt } }, { status: 202 });
    }
    await ensureDocumentMigrated(prisma, document.id);
    const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
    if (!currentDocument) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    if (currentDocument.format === 'MARKDOWN') {
      const main = await prisma.workspaceFile.findUnique({
        where: { documentId_path: { documentId: currentDocument.id, path: currentDocument.mainFilePath } },
        select: { content: true, checksum: true, revision: true },
      });
      if (!main) return NextResponse.json({ message: 'Main Markdown file not found' }, { status: 404 });
      const rows = await prisma.documentAsset.findMany({
        where: { documentId: currentDocument.id },
        select: { path: true, mediaType: true, bytes: true },
        orderBy: { path: 'asc' },
      });
      const assets = rows.map((row) => ({
        path: row.path,
        mediaType: row.mediaType,
        data: Buffer.from(row.bytes).toString('base64'),
      }));
      const jobId = await compilationProducer.addJob({
        documentId: currentDocument.id,
        userId,
        slug: currentDocument.slug,
        content: main.content ?? '',
        format: 'MARKDOWN',
        assets,
      });
      return NextResponse.json({
        message: 'Compilation job queued',
        jobId,
        reused: 'new',
        snapshot: { digest: main.checksum, mainFile: currentDocument.mainFilePath, files: [{ path: currentDocument.mainFilePath, checksum: main.checksum, revision: main.revision }] },
      }, { status: 202 });
    }

    const compiler = {
      engine: configuredEngine(),
      engineVersion: await engineVersion(),
      mainFile: currentDocument.mainFilePath,
      options: compilerOptionsForCacheKey(),
    };

    const snapshot = await createCompileSnapshot({
      documentId: currentDocument.id,
      userId,
      mainFile: currentDocument.mainFilePath,
      compiler,
    });

    if (!snapshot.ok && snapshot.ambiguous.length > 0) {
      return NextResponse.json(
        {
          message: 'Two files differ only by case, so an include cannot resolve unambiguously',
          ambiguous: snapshot.ambiguous,
        },
        { status: 409 },
      );
    }

    if (!snapshot.ok) {
      return NextResponse.json(
        {
          message: 'Compile stopped: some referenced files are missing',
          missing: snapshot.missing.map((item) => ({
            file: item.from,
            reference: item.raw,
            command: item.command,
          })),
        },
        { status: 422 },
      );
    }

    const { jobId, reused } = await compilationProducer.addSnapshotJob({
      documentId: currentDocument.id,
      userId,
      slug: currentDocument.slug,
      mainFile: snapshot.manifest.mainFile,
      digest: snapshot.digest,
      files: snapshot.manifest.files,
    });

    return NextResponse.json(
      {
        message: reused === 'new' ? 'Compilation job queued' : 'Reusing compile for identical source',
        jobId,
        reused,
        snapshot: { digest: snapshot.digest, mainFile: snapshot.manifest.mainFile, files: snapshot.manifest.files },
        rateLimit: { remaining: rateLimitResult.remaining, resetAt: rateLimitResult.resetAt },
      },
      {
        status: 202,
        headers: {
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
        },
      },
    );
  } catch (error) {
    console.error('[PDF_COMPILE_ERROR]', error instanceof Error ? error.message : error);
    return NextResponse.json({ message: 'Failed to queue compilation', error: 'Internal server error' }, { status: 500 });
  }
});
