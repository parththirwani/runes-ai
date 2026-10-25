import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";
import { authorizeJob } from "@/src/lib/job-access";

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return NextResponse.json({ message: "Job ID is required" }, { status: 400 });
    }

    // Status is a read of the document's compile output, so it honours current read access.
    const authorization = await authorizeJob(jobId, session.user.id, 'read');
    if (!authorization.ok) return authorization.response;

    const status = await compilationProducer.getJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ message: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    console.error("[JOB_STATUS_ERROR]", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});

// Cancel (DELETE) — a write on the document's compile pipeline, so it takes the edit intent.
export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return NextResponse.json({ message: "Job ID is required" }, { status: 400 });
    }

    // Cancelling affects everyone who can read the document, so it stays author-only and is
    // re-derived from current access instead of the userId stored in the job payload.
    const authorization = await authorizeJob(jobId, session.user.id, 'write');
    if (!authorization.ok) return authorization.response;

    const cancelled = await compilationProducer.cancelJob(jobId);
    if (!cancelled) {
      return NextResponse.json(
        { message: "Job not found or cannot be cancelled (already processing/completed)" },
        { status: 400 }
      );
    }

    return NextResponse.json({ message: "Job cancelled successfully" }, { status: 200 });
  } catch (error) {
    console.error("[JOB_CANCEL_ERROR]", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});
