// Multipart upload for images, .bib and other supported assets.
import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { WorkspaceError, WorkspacePathError, uploadFile } from '@/src/lib/workspace-files';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ message: 'Multipart form data is required' }, { status: 400 });
    }

    const fileField = form.get('file');
    const pathField = form.get('path');
    if (!(fileField instanceof File) || typeof pathField !== 'string') {
      return NextResponse.json({ message: 'file and path are required' }, { status: 400 });
    }
    if (fileField.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ message: 'Upload is larger than ' + Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024) + ' MB' }, { status: 413 });
    }

    // The path field decides where the bytes go; a client supplied filename never does.
    const bytes = Buffer.from(await fileField.arrayBuffer());
    const file = await uploadFile({
      userId: session.user.id,
      ref: slug,
      rawPath: pathField,
      bytes,
      mimeType: fileField.type || null,
    });
    if (!file) return NextResponse.json({ message: 'Document not found' }, { status: 404 });

    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error('[WORKSPACE_UPLOAD_ERROR]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
});
