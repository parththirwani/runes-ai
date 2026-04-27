// app/api/compilation/[jobId]/status/route.ts
import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;

    if (!jobId) {
      return NextResponse.json(
        { message: "Job ID is required" },
        { status: 400 }
      );
    }

    const status = await compilationProducer.getJobStatus(jobId);

    if (!status) {
      return NextResponse.json(
        { message: "Job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    console.error("[JOB_STATUS_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

// app/api/compilation/[jobId]/cancel/route.ts  (or keep in same file if you prefer)
export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;

    if (!jobId) {
      return NextResponse.json(
        { message: "Job ID is required" },
        { status: 400 }
      );
    }

    const cancelled = await compilationProducer.cancelJob(jobId);

    if (!cancelled) {
      return NextResponse.json(
        { message: "Job not found or cannot be cancelled (already processing/completed)" },
        { status: 400 }   // Changed from 404 → 400 is more semantic here
      );
    }

    return NextResponse.json(
      { message: "Job cancelled successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[JOB_CANCEL_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});