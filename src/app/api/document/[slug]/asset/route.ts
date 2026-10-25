// Serves binary workspace assets (figures) to anyone who may read the document.
import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { WorkspaceError, WorkspacePathError, readWorkspaceAsset } from '@/src/lib/workspace-files';
import { accessErrorResponse } from '@/src/lib/access';

export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return NextResponse.json({ message: 'path is required' }, { status: 400 });

    const asset = await readWorkspaceAsset(session.user.id, slug, path);
    if (!asset) return NextResponse.json({ message: 'Asset not found' }, { status: 404 });

    return new NextResponse(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': asset.bytes.length.toString(),
        // URLs are per workspace and access is ownership checked, so keep it private.
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const access = accessErrorResponse(error);
    if (access) return access;
    console.error('[WORKSPACE_ASSET_ERROR]', error instanceof Error ? error.constructor.name : 'unknown');
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
});
