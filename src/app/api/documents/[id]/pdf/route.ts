import { NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/withAuth';
import { openReadableDocument } from '@/src/lib/document-lookup';
import { compilationProducer } from '@/producer/queue';
import { JobStatus } from '@/src/types/compilation';
import { apiError } from '@/src/lib/api-errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Document-scoped PDF read.
 *
 * /api/pdf/[jobId] stays tied to whoever submitted the job, so an old job id can never outlive a
 * revocation. This route is the supported way for a viewer to see a finished PDF: it resolves the
 * most recent compile for the document and re-checks *current* read access to that document on
 * every request. No preview is offered when no author compile exists yet.
 */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const { id } = await context.params;
    const access = await openReadableDocument(session.user.id, id);
    if (!access) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const jobId = await compilationProducer.getLatestJobIdForDocument(access.document.id);
    if (!jobId) {
      return NextResponse.json({ error: 'No preview available', reason: 'never-compiled' }, { status: 404 });
    }

    const status = await compilationProducer.getJobStatus(jobId);
    if (!status || status.status !== JobStatus.COMPLETED) {
      return NextResponse.json({ error: 'No preview available', reason: status ? status.status : 'expired' }, { status: 404 });
    }

    const pdf = await compilationProducer.getPDF(jobId);
    if (!pdf || pdf.length === 0) {
      return NextResponse.json({ error: 'No preview available', reason: 'expired' }, { status: 404 });
    }

    // no-store: access can be revoked at any moment, and a cached copy would outlive the grant.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `inline; filename="${access.document.slug || access.document.id}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
});
