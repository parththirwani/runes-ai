import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";

// Helper: verify job belongs to user.
// Job data stores userId at creation time (field: job.userId).
// We read the raw job to check ownership before returning status/PDF.
async function verifyJobOwnership(jobId: string, userId: string): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  // Get the job data stored at creation
  const jobDataStr = await compilationProducer.getRawJobData(jobId);
  if (!jobDataStr) {
    return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
  }
  try {
    const jobData = JSON.parse(jobDataStr);
    if (jobData.userId !== userId) {
      return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
    }
    return { ok: true };
  } catch {
    return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
  }
}

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return NextResponse.json({ message: "Job ID is required" }, { status: 400 });
    }

    const userId = session.user.id;
    const ownership = await verifyJobOwnership(jobId, userId);
    if (!ownership.ok) return ownership.response;

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

// Cancel (DELETE) — also ownership-checked
export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return NextResponse.json({ message: "Job ID is required" }, { status: 400 });
    }

    const userId = session.user.id;
    const ownership = await verifyJobOwnership(jobId, userId);
    if (!ownership.ok) return ownership.response;

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
