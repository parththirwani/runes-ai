// Authorization for the job-scoped routes (/api/job/[jobId], /api/pdf/[jobId]).
//
// The submitting user id stored inside the job is only provenance, never permission: it was true
// when the compile was queued and says nothing about now. A former team member submitted their own
// jobs, so checking it alone lets an old job id outlive the removal. Every request therefore
// resolves the job's documentId and re-derives current document access through src/lib/access.ts,
// the same rules every other route uses. Denials answer with the same non-revealing 404 as an
// unknown job so probing a job id cannot distinguish "not yours" from "does not exist".

import { NextResponse } from 'next/server';
import { compilationProducer } from '@/producer/queue';
import { getDocumentAccess } from './access';

/** Same intent vocabulary as src/lib/document-lookup.ts: a read check never unlocks a mutation. */
export type JobIntent = 'read' | 'write';

export type JobAuthorization = { ok: true; documentId: string } | { ok: false; response: NextResponse };

function jobNotFound(): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ message: 'Job not found' }, { status: 404 }) };
}

/**
 * Reads the raw job payload and answers what `userId` may still do with this job's document.
 * `read` covers status polling and PDF download (accepted viewers included); `write` covers
 * cancellation, which stays author-only exactly like the compile route that created the job.
 */
export async function authorizeJob(jobId: string, userId: string, intent: JobIntent): Promise<JobAuthorization> {
  const jobDataStr = await compilationProducer.getRawJobData(jobId);
  if (!jobDataStr) return jobNotFound();

  let documentId: unknown;
  try {
    documentId = (JSON.parse(jobDataStr) as { documentId?: unknown }).documentId;
  } catch {
    return jobNotFound();
  }
  if (typeof documentId !== 'string' || documentId.length === 0) return jobNotFound();

  const access = await getDocumentAccess(userId, documentId);
  const allowed = intent === 'write' ? access?.capabilities.canEdit : access?.capabilities.canRead;
  if (!allowed) return jobNotFound();

  return { ok: true, documentId };
}
