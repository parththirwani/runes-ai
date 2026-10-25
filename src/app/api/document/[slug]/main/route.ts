// Selects which .tex file the compiler treats as the entry point.
import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { workspaceMainSchema } from '@/src/schema/documentSchema';
import { WorkspaceError, WorkspacePathError, setMainFile } from '@/src/lib/workspace-files';
import { accessErrorResponse } from '@/src/lib/access';

export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const parsed = workspaceMainSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: 'Invalid input' }, { status: 400 });

    const result = await setMainFile(session.user.id, slug, parsed.data.path);
    if (!result) return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    return NextResponse.json({ mainFilePath: result.mainFilePath });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const access = accessErrorResponse(error);
    if (access) return access;
    console.error('[WORKSPACE_MAIN_ERROR]', error instanceof Error ? error.constructor.name : 'unknown');
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
});
