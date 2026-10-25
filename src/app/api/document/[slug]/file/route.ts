// Single workspace file access: read, create, edit, delete.
// Ownership is resolved from the slug plus the authenticated user on every call.

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { workspaceFileWriteSchema } from '@/src/schema/documentSchema';
import {
  WorkspaceError,
  WorkspacePathError,
  deleteFile,
  readWorkspaceFile,
  writeTextFile,
} from '@/src/lib/workspace-files';
import { accessErrorResponse } from '@/src/lib/access';

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  const access = accessErrorResponse(error);
  if (access) return access;
  console.error('[WORKSPACE_FILE_ERROR]', error instanceof Error ? error.constructor.name : 'unknown');
  return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
}

function requestedPath(req: NextRequest): string | null {
  const value = req.nextUrl.searchParams.get('path');
  return value && value.length > 0 ? value : null;
}

export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const path = requestedPath(req);
    if (!path) return NextResponse.json({ message: 'path is required' }, { status: 400 });

    const file = await readWorkspaceFile(session.user.id, slug, path);
    if (!file) return NextResponse.json({ message: 'File not found' }, { status: 404 });
    if (file.binary) {
      return NextResponse.json(
        { message: 'Binary asset: load ' + path + ' from the asset endpoint', assetUrl: '/api/document/' + slug + '/asset?path=' + encodeURIComponent(path) },
        { status: 415 },
      );
    }
    return NextResponse.json({ file });
  } catch (error) {
    return errorResponse(error);
  }
});

export const PUT = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const body = await req.json();
    const parsed = workspaceFileWriteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: 'Invalid input' }, { status: 400 });

    const result = await writeTextFile({
      userId: session.user.id,
      slug,
      rawPath: parsed.data.path,
      content: parsed.data.content,
      baseRevision: parsed.data.baseRevision ?? null,
    });
    if (!result) return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    if ('conflict' in result) {
      return NextResponse.json({ message: 'The file changed since it was loaded', file: result.conflict }, { status: 409 });
    }
    return NextResponse.json({ file: result.file, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
});

export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const path = requestedPath(req);
    if (!path) return NextResponse.json({ message: 'path is required' }, { status: 400 });

    const result = await deleteFile(session.user.id, slug, path);
    if (!result) return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    if (result === 'mainfile') {
      return NextResponse.json({ message: 'Choose another main file before deleting this one' }, { status: 409 });
    }
    if (result === 'notfound') return NextResponse.json({ message: 'File not found' }, { status: 404 });
    return NextResponse.json({ message: 'File deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});
