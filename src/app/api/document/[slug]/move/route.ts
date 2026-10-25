// Rename or move a workspace file, including the main file pointer.
import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { workspaceMoveSchema } from '@/src/schema/documentSchema';
import { WorkspaceError, WorkspacePathError, moveFile } from '@/src/lib/workspace-files';

export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const parsed = workspaceMoveSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: 'Invalid input' }, { status: 400 });

    const result = await moveFile({ userId: session.user.id, ref: slug, from: parsed.data.from, to: parsed.data.to });
    if (!result) return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    if (result === 'notfound') return NextResponse.json({ message: 'File not found' }, { status: 404 });
    if (result === 'exists') return NextResponse.json({ message: 'A file already exists at that path' }, { status: 409 });

    return NextResponse.json({ file: result.file, mainFilePath: result.mainFilePath });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error('[WORKSPACE_MOVE_ERROR]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
});
